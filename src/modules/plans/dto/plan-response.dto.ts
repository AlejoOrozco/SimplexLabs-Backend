import { ApiProperty } from '@nestjs/swagger';
import type { Niche, PlanFeature, Channel } from '@prisma/client';

export class PlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['GYM', 'MEDICAL', 'ENTREPRENEUR'] })
  niche!: Niche;

  @ApiProperty({ description: 'Decimal serialized as string, e.g. "99.00"' })
  priceMonthly!: string;

  @ApiProperty({ description: 'Decimal serialized as string, e.g. "199.00"' })
  setupFee!: string;

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
