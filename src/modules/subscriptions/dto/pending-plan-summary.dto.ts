import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PlanCategory, PlanTier } from '@prisma/client';

export class PendingPlanSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ enum: ['BASIC', 'PROFESSIONAL', 'ENTERPRISE'], nullable: true })
  tier!: PlanTier | null;

  @ApiPropertyOptional({ enum: ['MARKETING', 'WEBSITE', 'AI_AGENTS'], nullable: true })
  category!: PlanCategory | null;

  @ApiProperty({ description: 'Decimal as string' })
  priceMonthly!: string;

  @ApiPropertyOptional({ nullable: true })
  priceAnnual!: string | null;
}
