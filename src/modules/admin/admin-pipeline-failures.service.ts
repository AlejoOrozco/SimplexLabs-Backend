import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ABSOLUTE_MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  resolvePagination,
} from '../../common/http/pagination';

const MESSAGE_PREVIEW_MAX = 800;

const agentRunFailureInclude = {
  conversation: {
    include: {
      company: { select: { id: true, name: true } },
      contact: {
        select: { firstName: true, lastName: true, phone: true },
      },
    },
  },
  triggerMessage: { select: { content: true, sentAt: true } },
} satisfies Prisma.AgentRunInclude;

type AgentRunFailureRow = Prisma.AgentRunGetPayload<{
  include: typeof agentRunFailureInclude;
}>;

export interface AgentRunFailureListItemDto {
  readonly id: string;
  readonly createdAt: string;
  readonly success: boolean;
  readonly error: string | null;
  readonly durationMs: number;
  readonly totalTokens: number;
  readonly conversation: {
    readonly id: string;
    readonly companyId: string;
    readonly channel: string;
    readonly company: { readonly id: string; readonly name: string };
    readonly contact: {
      readonly firstName: string;
      readonly lastName: string;
      readonly phone: string | null;
    };
  };
  readonly message: {
    readonly contentPreview: string;
    readonly sentAt: string;
  };
}

export interface AgentRunFailureListResponseDto {
  readonly tasks: AgentRunFailureListItemDto[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly totalPages: number;
}

@Injectable()
export class AdminPipelineFailuresService {
  constructor(private readonly prisma: PrismaService) {}

  async listAgentRunFailures(
    pageInput: number | undefined,
    limitInput: number | undefined,
    companyId?: string,
  ): Promise<AgentRunFailureListResponseDto> {
    const page = pageInput !== undefined && pageInput >= 1 ? pageInput : 1;
    const { limit } = resolvePagination({
      limit: limitInput,
      offset: 0,
      defaultLimit: DEFAULT_PAGE_LIMIT,
      maxLimit: ABSOLUTE_MAX_PAGE_LIMIT,
    });
    const offset = (page - 1) * limit;

    const where: Prisma.AgentRunWhereInput = {
      success: false,
      ...(companyId ? { conversation: { companyId } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.agentRun.findMany({
        where,
        include: agentRunFailureInclude,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.agentRun.count({ where }),
    ]);

    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);

    return {
      tasks: rows.map((r) => this.toListItem(r)),
      total,
      page,
      limit,
      totalPages,
    };
  }

  private toListItem(row: AgentRunFailureRow): AgentRunFailureListItemDto {
    const raw = row.triggerMessage.content;
    const preview =
      raw.length > MESSAGE_PREVIEW_MAX
        ? `${raw.slice(0, MESSAGE_PREVIEW_MAX)}…`
        : raw;

    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      success: row.success,
      error: row.error,
      durationMs: row.durationMs,
      totalTokens: row.totalTokens,
      conversation: {
        id: row.conversation.id,
        companyId: row.conversation.companyId,
        channel: row.conversation.channel,
        company: {
          id: row.conversation.company.id,
          name: row.conversation.company.name,
        },
        contact: {
          firstName: row.conversation.contact.firstName,
          lastName: row.conversation.contact.lastName,
          phone: row.conversation.contact.phone,
        },
      },
      message: {
        contentPreview: preview,
        sentAt: row.triggerMessage.sentAt.toISOString(),
      },
    };
  }
}
