import { ApiProperty } from '@nestjs/swagger';
import type { SubStatus } from '@prisma/client';
import { PlanResponseDto } from '../../plans/dto/plan-response.dto';

export class SubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  planId!: string;

  @ApiProperty({ enum: ['ACTIVE', 'PAUSED', 'CANCELLED'] })
  status!: SubStatus;

  @ApiProperty({ description: 'Decimal serialized as string, e.g. "99.00"' })
  initialPayment!: string;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  nextBillingAt!: Date | null;

  @ApiProperty({ type: PlanResponseDto })
  plan!: PlanResponseDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
