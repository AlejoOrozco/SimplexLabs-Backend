import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  KB_CATEGORY_MAX,
  KB_SEARCH_MAX,
} from '../../validation/limits';

const toBool = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
};

const toInt = ({ value }: { value: unknown }): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export class ListAgentKbQueryDto {
  @ApiPropertyOptional({ maxLength: KB_CATEGORY_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(KB_CATEGORY_MAX)
  category?: string;

  @ApiPropertyOptional({
    description:
      'If true, only active entries are returned. If false, only inactive. Omit to return both.',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring on title/content.',
    maxLength: KB_SEARCH_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(KB_SEARCH_MAX)
  search?: string;

  @ApiPropertyOptional({
    description: 'SUPER_ADMIN tenant selector; ignored for CLIENT callers.',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  offset?: number;
}
