import { Injectable, Logger } from '@nestjs/common';
import { AgentRole, Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { DEFAULT_PROMPTS } from './default-prompts';

const resolvedPromptSelect = {
  id: true,
  role: true,
  systemPrompt: true,
  model: true,
  temperature: true,
  maxTokens: true,
  isActive: true,
} satisfies Prisma.AgentPromptSelect;

type AgentPromptRow = Prisma.AgentPromptGetPayload<{
  select: typeof resolvedPromptSelect;
}>;

export interface ResolvedPrompt {
  source: 'database' | 'default';
  role: AgentRole;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface ResolvedAgentConfig {
  companyId: string;
  agentConfigId: string | null;
  name: string;
  language: string;
  fallbackMessage: string;
  escalationMessage: string;
  channels: Channel[];
  prompts: Record<AgentRole, ResolvedPrompt>;
}

/**
 * Loads the active AgentConfig + AgentPrompt rows for a company and maps
 * each AgentRole to a concrete prompt. If any role is missing in the DB,
 * the resolver falls back to the static `DEFAULT_PROMPTS` for that role —
 * never crashes. Callers can inspect `prompts[role].source` to tell which
 * scenario they're in.
 */
@Injectable()
export class PromptResolverService {
  private readonly logger = new Logger(PromptResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveForCompany(
    companyId: string,
    channel: Channel,
  ): Promise<ResolvedAgentConfig> {
    const config = await this.prisma.agentConfig.findFirst({
      where: {
        companyId,
        isActive: true,
        channels: { has: channel },
      },
      select: {
        id: true,
        name: true,
        language: true,
        fallbackMessage: true,
        escalationMessage: true,
        channels: true,
        prompts: {
          where: { isActive: true },
          select: resolvedPromptSelect,
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!config) {
      this.logger.warn(
        `No active AgentConfig for company=${companyId} channel=${channel} — using static defaults`,
      );
      return this.buildAllDefaults(companyId, null);
    }

    return {
      companyId,
      agentConfigId: config.id,
      name: config.name,
      language: config.language,
      fallbackMessage: config.fallbackMessage,
      escalationMessage: config.escalationMessage,
      channels: config.channels,
      prompts: this.mergeWithDefaults(config.prompts),
    };
  }

  private mergeWithDefaults(
    rows: AgentPromptRow[],
  ): Record<AgentRole, ResolvedPrompt> {
    const byRole = new Map<AgentRole, AgentPromptRow>();
    for (const row of rows) byRole.set(row.role, row);

    const out = {} as Record<AgentRole, ResolvedPrompt>;
    for (const fallback of DEFAULT_PROMPTS) {
      const match = byRole.get(fallback.role);
      if (match) {
        out[fallback.role] = {
          source: 'database',
          role: match.role,
          systemPrompt: match.systemPrompt,
          model: match.model,
          temperature: match.temperature,
          maxTokens: match.maxTokens,
        };
      } else {
        out[fallback.role] = {
          source: 'default',
          role: fallback.role,
          systemPrompt: fallback.systemPrompt,
          model: fallback.model,
          temperature: fallback.temperature,
          maxTokens: fallback.maxTokens,
        };
      }
    }
    return out;
  }

  private buildAllDefaults(
    companyId: string,
    agentConfigId: string | null,
  ): ResolvedAgentConfig {
    const prompts = {} as Record<AgentRole, ResolvedPrompt>;
    for (const fallback of DEFAULT_PROMPTS) {
      prompts[fallback.role] = {
        source: 'default',
        role: fallback.role,
        systemPrompt: fallback.systemPrompt,
        model: fallback.model,
        temperature: fallback.temperature,
        maxTokens: fallback.maxTokens,
      };
    }
    return {
      companyId,
      agentConfigId,
      name: 'Default',
      language: 'es',
      fallbackMessage:
        'Gracias por tu mensaje. Estamos teniendo un problema técnico temporal; en un momento un miembro del equipo te responde.',
      escalationMessage:
        'Voy a conectarte con una persona de nuestro equipo para que te ayude mejor.',
      channels: [Channel.WHATSAPP],
      prompts,
    };
  }
}
