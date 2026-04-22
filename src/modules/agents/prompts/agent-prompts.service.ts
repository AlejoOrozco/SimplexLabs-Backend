import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AgentRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
} from '../../../common/tenant/tenant-scope';
import { DEFAULT_PROMPTS } from './default-prompts';
import {
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  SUPPORTED_MODELS,
  SYSTEM_PROMPT_MAX,
  SYSTEM_PROMPT_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  sanitizeMultilineText,
} from '../validation/limits';
import { UpdateAgentPromptDto } from './dto/update-agent-prompt.dto';
import { AgentPromptResponseDto } from './dto/agent-prompt-response.dto';

const promptSelect = {
  id: true,
  agentConfigId: true,
  role: true,
  systemPrompt: true,
  model: true,
  temperature: true,
  maxTokens: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgentPromptSelect;

type AgentPromptRow = Prisma.AgentPromptGetPayload<{ select: typeof promptSelect }>;

/**
 * Service for the company's per-role prompt configuration.
 *
 * The schema enforces one prompt per role via `@@unique([agentConfigId, role])`.
 * This service layer adds:
 *   - tenant safety (CLIENT cannot see or edit another company's prompts),
 *   - model whitelist / bounds validation (defense in depth vs. DTO),
 *   - auto-creation of missing role rows at first update (so a client can
 *     author a previously-default prompt without a separate "create"
 *     endpoint),
 *   - a deactivation guardrail on RESPONDER (the customer-facing step).
 */
@Injectable()
export class AgentPromptsService {
  private readonly logger = new Logger(AgentPromptsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List all 5 roles for the active AgentConfig of `companyId`, filling in
   * placeholder rows for missing roles so the UI always has a complete set.
   */
  async listForCompany(
    requester: AuthenticatedUser,
    providedCompanyId?: string,
  ): Promise<AgentPromptResponseDto[]> {
    const companyId = resolveCompanyId(requester, providedCompanyId);
    assertTenantAccess(companyId, requester);

    const agentConfigId = await this.resolveActiveConfigId(companyId);
    if (!agentConfigId) {
      throw new NotFoundException(
        `No active AgentConfig for company ${companyId}.`,
      );
    }

    const rows = await this.prisma.agentPrompt.findMany({
      where: { agentConfigId },
      select: promptSelect,
      orderBy: { role: 'asc' },
    });

    return this.mergeWithDefaults(agentConfigId, rows);
  }

  async updateRole(
    role: AgentRole,
    dto: UpdateAgentPromptDto,
    requester: AuthenticatedUser,
    providedCompanyId?: string,
  ): Promise<AgentPromptResponseDto> {
    const companyId = resolveCompanyId(requester, providedCompanyId);
    assertTenantAccess(companyId, requester);

    const agentConfigId = await this.resolveActiveConfigId(companyId);
    if (!agentConfigId) {
      throw new NotFoundException(
        `No active AgentConfig for company ${companyId}.`,
      );
    }

    const existing = await this.prisma.agentPrompt.findUnique({
      where: {
        agentConfigId_role: { agentConfigId, role },
      },
      select: promptSelect,
    });

    if (role === AgentRole.RESPONDER && dto.isActive === false) {
      throw new BadRequestException(
        'Refusing to deactivate the RESPONDER prompt — the customer-facing step must always be active.',
      );
    }

    const sanitizedPrompt = dto.systemPrompt !== undefined
      ? sanitizeMultilineText(dto.systemPrompt)
      : undefined;
    if (sanitizedPrompt !== undefined) {
      if (sanitizedPrompt.length < SYSTEM_PROMPT_MIN) {
        throw new BadRequestException(
          `systemPrompt must be at least ${SYSTEM_PROMPT_MIN} characters after sanitization.`,
        );
      }
      if (sanitizedPrompt.length > SYSTEM_PROMPT_MAX) {
        throw new BadRequestException(
          `systemPrompt must be at most ${SYSTEM_PROMPT_MAX} characters.`,
        );
      }
    }

    if (dto.model !== undefined) {
      const allowed = SUPPORTED_MODELS as readonly string[];
      if (!allowed.includes(dto.model)) {
        throw new BadRequestException(
          `Unsupported model "${dto.model}". Allowed: ${allowed.join(', ')}.`,
        );
      }
    }

    if (
      dto.temperature !== undefined &&
      (dto.temperature < TEMPERATURE_MIN || dto.temperature > TEMPERATURE_MAX)
    ) {
      throw new BadRequestException(
        `temperature must be between ${TEMPERATURE_MIN} and ${TEMPERATURE_MAX}.`,
      );
    }

    if (
      dto.maxTokens !== undefined &&
      (dto.maxTokens < MAX_TOKENS_MIN || dto.maxTokens > MAX_TOKENS_MAX)
    ) {
      throw new BadRequestException(
        `maxTokens must be between ${MAX_TOKENS_MIN} and ${MAX_TOKENS_MAX}.`,
      );
    }

    if (existing) {
      const data: Prisma.AgentPromptUpdateInput = {};
      if (sanitizedPrompt !== undefined) data.systemPrompt = sanitizedPrompt;
      if (dto.model !== undefined) data.model = dto.model;
      if (dto.temperature !== undefined) data.temperature = dto.temperature;
      if (dto.maxTokens !== undefined) data.maxTokens = dto.maxTokens;
      if (dto.isActive !== undefined) data.isActive = dto.isActive;

      const updated = await this.prisma.agentPrompt.update({
        where: { id: existing.id },
        data,
        select: promptSelect,
      });
      this.logger.log(
        `AgentPrompt ${updated.id} (role=${role}) updated by user=${requester.id} (company=${companyId}).`,
      );
      return toDto(updated);
    }

    // Row missing → author one. We seed from DEFAULT_PROMPTS then overlay
    // whatever fields the DTO provided. This means clients never need a
    // separate "create role" endpoint — the first update IS the create.
    const fallback = DEFAULT_PROMPTS.find((p) => p.role === role);
    if (!fallback) {
      throw new BadRequestException(`Unsupported role: ${role}`);
    }

    try {
      const created = await this.prisma.agentPrompt.create({
        data: {
          agentConfigId,
          role,
          systemPrompt: sanitizedPrompt ?? fallback.systemPrompt,
          model: dto.model ?? fallback.model,
          temperature: dto.temperature ?? fallback.temperature,
          maxTokens: dto.maxTokens ?? fallback.maxTokens,
          isActive: dto.isActive ?? true,
        },
        select: promptSelect,
      });
      this.logger.log(
        `AgentPrompt ${created.id} (role=${role}) created by user=${requester.id} (company=${companyId}).`,
      );
      return toDto(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          `A prompt for role ${role} already exists on this config.`,
        );
      }
      throw error;
    }
  }

  /**
   * Deterministic active-config resolver. Kept local to avoid a hard
   * dependency on AgentConfigService (no circular injection).
   */
  private async resolveActiveConfigId(companyId: string): Promise<string | null> {
    const config = await this.prisma.agentConfig.findFirst({
      where: { companyId, isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return config?.id ?? null;
  }

  private mergeWithDefaults(
    agentConfigId: string,
    rows: AgentPromptRow[],
  ): AgentPromptResponseDto[] {
    const byRole = new Map<AgentRole, AgentPromptRow>();
    for (const row of rows) byRole.set(row.role, row);

    return DEFAULT_PROMPTS.map((fallback): AgentPromptResponseDto => {
      const existing = byRole.get(fallback.role);
      if (existing) return toDto(existing);
      // Synthetic placeholder — not yet persisted. `id` carries a stable
      // pseudo-value the UI can use as React key, but any update will
      // create the real row (see `updateRole`).
      return {
        id: `default:${agentConfigId}:${fallback.role}`,
        agentConfigId,
        role: fallback.role,
        systemPrompt: fallback.systemPrompt,
        model: fallback.model,
        temperature: fallback.temperature,
        maxTokens: fallback.maxTokens,
        isActive: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
    });
  }
}

function toDto(row: AgentPromptRow): AgentPromptResponseDto {
  return {
    id: row.id,
    agentConfigId: row.agentConfigId,
    role: row.role,
    systemPrompt: row.systemPrompt,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
