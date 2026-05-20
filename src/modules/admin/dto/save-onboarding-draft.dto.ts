import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class SaveOnboardingDraftDto {
  @ApiPropertyOptional({
    description: 'When set, updates an existing draft owned by the caller.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^c[a-z0-9]{20,32}$/i, { message: 'draftId must be a valid cuid' })
  draftId?: string;

  @ApiProperty({ minimum: 1, maximum: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  step!: number;

  @ApiProperty({
    description: 'Opaque wizard state (per step).',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  data!: Record<string, unknown>;
}
