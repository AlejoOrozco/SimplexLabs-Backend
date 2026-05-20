import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  Niche,
  PlanFeature,
  Channel,
  PlanCategory,
  PlanTier,
} from '@prisma/client';

export class PlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['GYM', 'MEDICAL', 'ENTREPRENEUR'] })
  niche!: Niche;

  @ApiPropertyOptional({ enum: ['MARKETING', 'WEBSITE', 'AI_AGENTS'] })
  category?: PlanCategory | null;

  @ApiPropertyOptional({ enum: ['BASIC', 'PROFESSIONAL', 'ENTERPRISE'] })
  tier?: PlanTier | null;

  @ApiProperty({ description: 'Decimal serialized as string, e.g. "99.00"' })
  priceMonthly!: string;

  @ApiPropertyOptional({
    description: 'Annual price when set, as decimal string',
  })
  priceAnnual?: string | null;

  @ApiProperty({ description: 'Decimal serialized as string, e.g. "199.00"' })
  setupFee!: string;

  @ApiPropertyOptional()
  maxCampaigns?: number | null;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({
    enum: ['WEBSITE', 'MARKETING', 'AGENTS'],
    isArray: true,
  })
  features!: PlanFeature[];

  @ApiProperty({
    enum: ['WHATSAPP', 'INSTAGRAM', 'MESSENGER'],
    isArray: true,
  })
  channels!: Channel[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
