import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { assertTenantAccess } from '../../common/tenant/tenant-scope';
import { AgentRunResponseDto } from './dto/agent-run-response.dto';

const AGENT_RUN_SELECT = {
  id: true,
  conversationId: true,
  messageId: true,
  success: true,
  error: true,
  totalTokens: true,
  durationMs: true,
  createdAt: true,
  analyzerInput: true,
  analyzerOutput: true,
  retrieverInput: true,
  retrieverOutput: true,
  deciderInput: true,
  deciderOutput: true,
  executorInput: true,
  executorOutput: true,
  responderInput: true,
  responderOutput: true,
} satisfies Prisma.AgentRunSelect;

type AgentRunRow = Prisma.AgentRunGetPayload<{ select: typeof AGENT_RUN_SELECT }>;

/** Upper bound on observability queries — prevents accidental large reads. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * List the runs for a conversation, newest first. Tenant-scoped: CLIENTs
   * can only read runs of conversations that belong to their company;
   * SUPER_ADMINs can read any.
   */
  async listRunsForConversation(
    conversationId: string,
    requester: AuthenticatedUser,
    options: { limit?: number } = {},
  ): Promise<AgentRunResponseDto[]> {
    const limit = clampLimit(options.limit);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { companyId: true },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    assertTenantAccess(conversation.companyId, requester);

    const rows = await this.prisma.agentRun.findMany({
      where: { conversationId },
      select: AGENT_RUN_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDto);
  }

  /**
   * Admin-only list of recent failed runs across all tenants. CLIENTs are
   * rejected — this is a global operator tool.
   */
  async listRecentFailedRuns(
    requester: AuthenticatedUser,
    options: { limit?: number } = {},
  ): Promise<AgentRunResponseDto[]> {
    if (requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only SUPER_ADMIN may list failed runs');
    }
    const limit = clampLimit(options.limit);

    const rows = await this.prisma.agentRun.findMany({
      where: { success: false },
      select: AGENT_RUN_SELECT,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDto);
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function toDto(row: AgentRunRow): AgentRunResponseDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    success: row.success,
    error: row.error,
    totalTokens: row.totalTokens,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
    analyzerInput: row.analyzerInput,
    analyzerOutput: row.analyzerOutput,
    retrieverInput: row.retrieverInput,
    retrieverOutput: row.retrieverOutput,
    deciderInput: row.deciderInput,
    deciderOutput: row.deciderOutput,
    executorInput: row.executorInput,
    executorOutput: row.executorOutput,
    responderInput: row.responderInput,
    responderOutput: row.responderOutput,
  };
}
