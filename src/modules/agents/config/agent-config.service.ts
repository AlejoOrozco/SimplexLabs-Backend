import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
} from '../../../common/tenant/tenant-scope';
import {
  DEFAULT_ESCALATION_MESSAGE,
  DEFAULT_FALLBACK_MESSAGE,
} from '../prompts/default-prompts';
import { AgentDefaultsService } from '../bootstrap/agent-defaults.service';
import { sanitizeMultilineText, sanitizeSingleLineText } from '../validation/limits';
import { UpdateAgentConfigDto } from './dto/update-agent-config.dto';
import { AgentConfigResponseDto } from './dto/agent-config-response.dto';

const configSelect = {
  id: true,
  companyId: true,
  name: true,
  isActive: true,
  channels: true,
  fallbackMessage: true,
  escalationMessage: true,
  language: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgentConfigSelect;

type AgentConfigRow = Prisma.AgentConfigGetPayload<{ select: typeof configSelect }>;

/**
 * Service responsible for the "agent profile" surface clients edit from the
 * dashboard: the name / messages / channels / language on an AgentConfig row.
 *
 * Active-config resolution is DETERMINISTIC and matches the runtime
 * resolver in `PromptResolverService`: the oldest `isActive = true` row
 * wins. If no active row exists, this service lazy-seeds one using
 * `AgentDefaultsService` so clients never land on an empty dashboard.
 */
@Injectable()
export class AgentConfigService {
  private readonly logger = new Logger(AgentConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defaults: AgentDefaultsService,
  ) {}

  /**
   * Returns the currently-active config for `companyId`, seeding defaults
   * if the tenant has none yet. SUPER_ADMIN callers must pass the target
   * companyId; CLIENT callers always use their own.
   */
  async getActive(
    requester: AuthenticatedUser,
    providedCompanyId?: string,
  ): Promise<AgentConfigResponseDto> {
    const companyId = resolveCompanyId(requester, providedCompanyId);
    assertTenantAccess(companyId, requester);

    let row = await this.findActive(companyId);
    if (!row) {
      this.logger.log(
        `No AgentConfig for company=${companyId}; lazy-seeding defaults.`,
      );
      const { agentConfigId } = await this.defaults.seedForCompany(companyId);
      row = await this.prisma.agentConfig.findUniqueOrThrow({
        where: { id: agentConfigId },
        select: configSelect,
      });
    }
    return toDto(row);
  }

  async update(
    dto: UpdateAgentConfigDto,
    requester: AuthenticatedUser,
    providedCompanyId?: string,
  ): Promise<AgentConfigResponseDto> {
    const companyId = resolveCompanyId(requester, providedCompanyId);
    assertTenantAccess(companyId, requester);

    const current = await this.findActive(companyId);
    if (!current) {
      throw new NotFoundException(
        `No active AgentConfig for company ${companyId}. Seed defaults first.`,
      );
    }

    const data: Prisma.AgentConfigUpdateInput = {};

    if (dto.name !== undefined) {
      const name = sanitizeSingleLineText(dto.name);
      if (name.length === 0) {
        throw new BadRequestException('name cannot be empty');
      }
      data.name = name;
    }

    if (dto.channels !== undefined) {
      const channels = dedupe(dto.channels).map(asChannel);
      if (channels.length === 0) {
        throw new BadRequestException('channels must not be empty');
      }
      data.channels = { set: channels };
    }

    if (dto.fallbackMessage !== undefined) {
      const text = sanitizeMultilineText(dto.fallbackMessage);
      if (text.length === 0) {
        throw new BadRequestException('fallbackMessage cannot be empty');
      }
      data.fallbackMessage = text;
    }

    if (dto.escalationMessage !== undefined) {
      const text = sanitizeMultilineText(dto.escalationMessage);
      if (text.length === 0) {
        throw new BadRequestException('escalationMessage cannot be empty');
      }
      data.escalationMessage = text;
    }

    if (dto.language !== undefined) {
      data.language = dto.language;
    }

    if (dto.isActive !== undefined) {
      if (dto.isActive === false && current.isActive) {
        const otherActive = await this.prisma.agentConfig.count({
          where: {
            companyId,
            isActive: true,
            id: { not: current.id },
          },
        });
        if (otherActive === 0) {
          throw new BadRequestException(
            'Refusing to deactivate the only active AgentConfig — the agent pipeline would fall back to hardcoded defaults for every customer.',
          );
        }
      }
      data.isActive = dto.isActive;
    }

    const updated = await this.prisma.agentConfig.update({
      where: { id: current.id },
      data,
      select: configSelect,
    });

    this.logger.log(
      `AgentConfig ${updated.id} updated by user=${requester.id} (company=${companyId}).`,
    );
    return toDto(updated);
  }

  /**
   * Deterministic active-config resolver. Matches `PromptResolverService`:
   * oldest `isActive=true` row. If multiple actives exist historically
   * (from an older migration), the deterministic pick is still stable.
   */
  private async findActive(companyId: string): Promise<AgentConfigRow | null> {
    return this.prisma.agentConfig.findFirst({
      where: { companyId, isActive: true },
      select: configSelect,
      orderBy: { createdAt: 'asc' },
    });
  }
}

function toDto(row: AgentConfigRow): AgentConfigResponseDto {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    isActive: row.isActive,
    channels: row.channels,
    fallbackMessage: row.fallbackMessage || DEFAULT_FALLBACK_MESSAGE,
    escalationMessage: row.escalationMessage || DEFAULT_ESCALATION_MESSAGE,
    language: row.language,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function asChannel(value: string): Channel {
  switch (value) {
    case 'WHATSAPP':
      return Channel.WHATSAPP;
    case 'INSTAGRAM':
      return Channel.INSTAGRAM;
    case 'MESSENGER':
      return Channel.MESSENGER;
    default:
      throw new BadRequestException(`Unsupported channel: ${value}`);
  }
}
