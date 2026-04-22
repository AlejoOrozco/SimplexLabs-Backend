import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  SUPPORTED_MODELS,
  SYSTEM_PROMPT_MAX,
  SYSTEM_PROMPT_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  type SupportedModel,
} from '../../validation/limits';

export class UpdateAgentPromptDto {
  @ApiPropertyOptional({
    minLength: SYSTEM_PROMPT_MIN,
    maxLength: SYSTEM_PROMPT_MAX,
  })
  @IsOptional()
  @IsString()
  @MinLength(SYSTEM_PROMPT_MIN)
  @MaxLength(SYSTEM_PROMPT_MAX)
  systemPrompt?: string;

  @ApiPropertyOptional({
    enum: SUPPORTED_MODELS,
    description: 'Whitelisted Groq model identifier.',
  })
  @IsOptional()
  @IsIn(SUPPORTED_MODELS)
  model?: SupportedModel;

  @ApiPropertyOptional({
    minimum: TEMPERATURE_MIN,
    maximum: TEMPERATURE_MAX,
    example: 0.3,
  })
  @IsOptional()
  @IsNumber()
  @Min(TEMPERATURE_MIN)
  @Max(TEMPERATURE_MAX)
  temperature?: number;

  @ApiPropertyOptional({ minimum: MAX_TOKENS_MIN, maximum: MAX_TOKENS_MAX })
  @IsOptional()
  @IsInt()
  @Min(MAX_TOKENS_MIN)
  @Max(MAX_TOKENS_MAX)
  maxTokens?: number;

  @ApiPropertyOptional({
    description:
      'Deactivating falls back to the static default prompt for that role. Deactivating RESPONDER is blocked.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
