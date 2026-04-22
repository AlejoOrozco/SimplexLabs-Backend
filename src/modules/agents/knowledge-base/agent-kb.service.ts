import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
  scopedCompanyWhere,
} from '../../../common/tenant/tenant-scope';
import {
  sanitizeMultilineText,
  sanitizeSingleLineText,
} from '../validation/limits';
import { AgentKbResponseDto } from './dto/agent-kb-response.dto';
import { CreateAgentKbDto } from './dto/create-agent-kb.dto';
import { UpdateAgentKbDto } from './dto/update-agent-kb.dto';
import { ListAgentKbQueryDto } from './dto/list-agent-kb-query.dto';

const kbSelect = {
  id: true,
  companyId: true,
  title: true,
  content: true,
  category: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgentKnowledgeBaseSelect;

type KbRow = Prisma.AgentKnowledgeBaseGetPayload<{ select: typeof kbSelect }>;

export interface AgentKbListResult {
  items: AgentKbResponseDto[];
  total: number;
}

const DEFAULT_LIMIT = 50;

/**
 * CRUD service for `AgentKnowledgeBase`. Every query is company-scoped:
 *   - CLIENT: via `scopedCompanyWhere` (their companyId).
 *   - SUPER_ADMIN: cross-tenant by default; may filter by `companyId`.
 *
 * Deletions are soft by policy: flipping `isActive=false` hides the entry
 * from the runtime retriever (`PhaseA fetchKnowledgeBase` already filters
 * `isActive: true`). Hard deletion is reserved for operator tooling.
 */
@Injectable()
export class AgentKbService {
  private readonly logger = new Logger(AgentKbService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListAgentKbQueryDto,
    requester: AuthenticatedUser,
  ): Promise<AgentKbListResult> {
    const where: Prisma.AgentKnowledgeBaseWhereInput = {
      ...scopedCompanyWhere(requester),
    };

    if (requester.role === 'SUPER_ADMIN' && query.companyId) {
      where.companyId = query.companyId;
    }

    if (query.category) {
      where.category = sanitizeSingleLineText(query.category);
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.search) {
      const term = sanitizeSingleLineText(query.search);
      if (term.length > 0) {
        where.OR = [
          { title: { contains: term, mode: Prisma.QueryMode.insensitive } },
          { content: { contains: term, mode: Prisma.QueryMode.insensitive } },
        ];
      }
    }

    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.agentKnowledgeBase.findMany({
        where,
        select: kbSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.agentKnowledgeBase.count({ where }),
    ]);

    return { items: rows.map(toDto), total };
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    const row = await this.prisma.agentKnowledgeBase.findUnique({
      where: { id },
      select: kbSelect,
    });
    if (!row) {
      throw new NotFoundException(`KB entry ${id} not found`);
    }
    assertTenantAccess(row.companyId, requester);
    return toDto(row);
  }

  async create(
    dto: CreateAgentKbDto,
    requester: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    const companyId = resolveCompanyId(requester, dto.companyId);

    const title = sanitizeSingleLineText(dto.title);
    const content = sanitizeMultilineText(dto.content);
    if (title.length === 0) {
      throw new BadRequestException('title cannot be empty after sanitization');
    }
    if (content.length === 0) {
      throw new BadRequestException('content cannot be empty after sanitization');
    }

    try {
      const created = await this.prisma.agentKnowledgeBase.create({
        data: {
          companyId,
          title,
          content,
          category: dto.category
            ? sanitizeSingleLineText(dto.category) || null
            : null,
          isActive: dto.isActive ?? true,
        },
        select: kbSelect,
      });
      this.logger.log(
        `KB entry ${created.id} created by user=${requester.id} (company=${companyId}).`,
      );
      return toDto(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new NotFoundException(`Company ${companyId} not found`);
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateAgentKbDto,
    requester: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    const existing = await this.prisma.agentKnowledgeBase.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!existing) {
      throw new NotFoundException(`KB entry ${id} not found`);
    }
    assertTenantAccess(existing.companyId, requester);

    const data: Prisma.AgentKnowledgeBaseUpdateInput = {};

    if (dto.title !== undefined) {
      const title = sanitizeSingleLineText(dto.title);
      if (title.length === 0) {
        throw new BadRequestException('title cannot be empty after sanitization');
      }
      data.title = title;
    }

    if (dto.content !== undefined) {
      const content = sanitizeMultilineText(dto.content);
      if (content.length === 0) {
        throw new BadRequestException('content cannot be empty after sanitization');
      }
      data.content = content;
    }

    if (dto.category !== undefined) {
      data.category = dto.category === null || dto.category === ''
        ? null
        : sanitizeSingleLineText(dto.category) || null;
    }

    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    const updated = await this.prisma.agentKnowledgeBase.update({
      where: { id },
      data,
      select: kbSelect,
    });

    this.logger.log(
      `KB entry ${updated.id} updated by user=${requester.id} (company=${updated.companyId}).`,
    );
    return toDto(updated);
  }

  /**
   * Soft-delete (flip isActive=false). Idempotent — already-inactive
   * entries return `{ deleted: true }` without raising. The row persists
   * so operators keep an audit trail and can reactivate later.
   */
  async softDelete(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    const existing = await this.prisma.agentKnowledgeBase.findUnique({
      where: { id },
      select: { companyId: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException(`KB entry ${id} not found`);
    }
    assertTenantAccess(existing.companyId, requester);

    if (!existing.isActive) {
      return { deleted: true };
    }

    await this.prisma.agentKnowledgeBase.update({
      where: { id },
      data: { isActive: false },
      select: { id: true },
    });
    this.logger.log(
      `KB entry ${id} soft-deleted by user=${requester.id} (company=${existing.companyId}).`,
    );
    return { deleted: true };
  }

  async reactivate(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<AgentKbResponseDto> {
    const existing = await this.prisma.agentKnowledgeBase.findUnique({
      where: { id },
      select: { companyId: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException(`KB entry ${id} not found`);
    }
    assertTenantAccess(existing.companyId, requester);

    const updated = await this.prisma.agentKnowledgeBase.update({
      where: { id },
      data: { isActive: true },
      select: kbSelect,
    });
    return toDto(updated);
  }
}

function toDto(row: KbRow): AgentKbResponseDto {
  return {
    id: row.id,
    companyId: row.companyId,
    title: row.title,
    content: row.content,
    category: row.category,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
