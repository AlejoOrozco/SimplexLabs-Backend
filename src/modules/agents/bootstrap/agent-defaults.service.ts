import { Injectable, Logger } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  DEFAULT_ESCALATION_MESSAGE,
  DEFAULT_FALLBACK_MESSAGE,
  DEFAULT_PROMPTS,
} from '../prompts/default-prompts';

type PrismaTx = Prisma.TransactionClient;

/**
 * Creates the initial AgentConfig + AgentPrompt rows for a freshly-created
 * company. Idempotent: re-invoking on a company that already has an
 * AgentConfig is a no-op.
 *
 * Called from:
 *   - AuthService.register (local signup path)
 *   - AuthService.handleOAuthCallback (Google OAuth path)
 */
@Injectable()
export class AgentDefaultsService {
  private readonly logger = new Logger(AgentDefaultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seedForCompany(
    companyId: string,
    options: { tx?: PrismaTx } = {},
  ): Promise<{ created: boolean; agentConfigId: string }> {
    const client = options.tx ?? this.prisma;

    const existing = await client.agentConfig.findFirst({
      where: { companyId },
      select: { id: true },
    });
    if (existing) {
      return { created: false, agentConfigId: existing.id };
    }

    const config = await client.agentConfig.create({
      data: {
        companyId,
        name: 'Default',
        isActive: true,
        channels: [Channel.WHATSAPP],
        fallbackMessage: DEFAULT_FALLBACK_MESSAGE,
        escalationMessage: DEFAULT_ESCALATION_MESSAGE,
        language: 'es',
      },
      select: { id: true },
    });

    await client.agentPrompt.createMany({
      data: DEFAULT_PROMPTS.map((p) => ({
        agentConfigId: config.id,
        role: p.role,
        systemPrompt: p.systemPrompt,
        model: p.model,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    this.logger.log(
      `Seeded default AgentConfig ${config.id} with ${DEFAULT_PROMPTS.length} prompts for company ${companyId}`,
    );
    return { created: true, agentConfigId: config.id };
  }
}
