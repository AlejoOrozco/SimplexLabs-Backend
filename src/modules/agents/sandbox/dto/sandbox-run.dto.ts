import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import {
  LANGUAGE_WHITELIST,
  SANDBOX_MESSAGE_MAX,
  type SupportedLanguage,
} from '../../validation/limits';

/**
 * Dry-run request. Simulates a full pipeline execution against the
 * company's LIVE config / prompts / KB — zero side effects.
 */
export class SandboxRunDto {
  @ApiProperty({
    description: "The customer's message the agent should reason about.",
    maxLength: SANDBOX_MESSAGE_MAX,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(SANDBOX_MESSAGE_MAX)
  simulatedMessage!: string;

  @ApiPropertyOptional({
    enum: Channel,
    default: Channel.WHATSAPP,
    description:
      'Channel the config should resolve for. Must be enabled on the active AgentConfig.',
  })
  @IsOptional()
  @IsEnum(Channel)
  channel?: Channel;

  @ApiPropertyOptional({
    description:
      'Fake customer handle — pure metadata; no WhatsApp traffic is generated.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  simulatedFrom?: string;

  @ApiPropertyOptional({
    enum: LANGUAGE_WHITELIST,
    description: 'Force a specific language (overrides analyzer detection).',
  })
  @IsOptional()
  @IsIn(LANGUAGE_WHITELIST)
  forceLanguage?: SupportedLanguage;

  /** SUPER_ADMIN tenant selector; ignored for CLIENT callers. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
