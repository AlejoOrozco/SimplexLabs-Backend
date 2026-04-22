import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';
import {
  AGENT_NAME_MAX,
  CONFIGURABLE_CHANNELS,
  LANGUAGE_WHITELIST,
  MESSAGE_MAX,
  type ConfigurableChannel,
  type SupportedLanguage,
} from '../../validation/limits';

/**
 * Editable fields on the company's active AgentConfig.
 *
 * Every field is optional — PATCH semantics. Empty strings are rejected by
 * `MinLength(1)`; the service additionally re-checks fallback/escalation
 * against the current row so the resulting state is never invalid.
 */
export class UpdateAgentConfigDto {
  @ApiPropertyOptional({ example: 'Clínica Pulso', maxLength: AGENT_NAME_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ enum: Channel, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(CONFIGURABLE_CHANNELS.length)
  @ArrayUnique()
  @IsIn(CONFIGURABLE_CHANNELS, { each: true })
  channels?: ConfigurableChannel[];

  @ApiPropertyOptional({ maxLength: MESSAGE_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  fallbackMessage?: string;

  @ApiPropertyOptional({ maxLength: MESSAGE_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MESSAGE_MAX)
  escalationMessage?: string;

  @ApiPropertyOptional({ enum: LANGUAGE_WHITELIST })
  @IsOptional()
  @IsIn(LANGUAGE_WHITELIST)
  language?: SupportedLanguage;

  @ApiPropertyOptional({
    description:
      'Activate / deactivate the config. Deactivating the only active config for a company is blocked to avoid breaking the runtime pipeline.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
