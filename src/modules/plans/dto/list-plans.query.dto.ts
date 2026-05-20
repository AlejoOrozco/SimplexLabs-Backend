import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { Niche, PlanCategory, PlanTier } from '@prisma/client';

export class ListPlansQueryDto {
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
}

export class PlansByCategoryQueryDto {
  @ApiPropertyOptional({ enum: Niche })
  @IsOptional()
  @IsEnum(Niche)
  niche?: Niche;
}
