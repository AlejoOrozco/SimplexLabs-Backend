import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Niche, PlanCategory, PlanTier } from '@prisma/client';

const toBool = ({ value }: { value: unknown }): boolean | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
};

export class AdminListPlansQueryDto {
  @ApiPropertyOptional({ enum: PlanCategory })
  @IsOptional()
  @IsEnum(PlanCategory)
  category?: PlanCategory;

  @ApiPropertyOptional({ enum: Niche })
  @IsOptional()
  @IsEnum(Niche)
  niche?: Niche;

  @ApiPropertyOptional({ enum: PlanTier })
  @IsOptional()
  @IsEnum(PlanTier)
  tier?: PlanTier;

  @ApiPropertyOptional({
    description: 'When true, only active plans. When false, only inactive. Omit for all.',
    default: false,
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  activeOnly?: boolean;
}
