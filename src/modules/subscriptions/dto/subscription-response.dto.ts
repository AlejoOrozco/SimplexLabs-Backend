import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  SubStatus,
  PlanCategory,
  BillingCycle,
  SubscriptionUpgradeStatus,
} from '@prisma/client';
import { PlanResponseDto } from '../../plans/dto/plan-response.dto';
import { PendingPlanSummaryDto } from './pending-plan-summary.dto';
import { BillingRecordResponseDto } from './billing-record-response.dto';

export class SubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  planId!: string;

  @ApiProperty({ enum: ['ACTIVE', 'PAUSED', 'CANCELLED'] })
  status!: SubStatus;

  @ApiPropertyOptional({ enum: ['MARKETING', 'WEBSITE', 'AI_AGENTS'], nullable: true })
  category!: PlanCategory | null;

  @ApiProperty({ enum: ['MONTHLY', 'ANNUAL'] })
  billingCycle!: BillingCycle;

  @ApiPropertyOptional({ type: Date, nullable: true })
  currentPeriodStart!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  currentPeriodEnd!: Date | null;

  @ApiPropertyOptional({ type: Date, nullable: true })
  overdueSince!: Date | null;

  @ApiProperty()
  gracePeriodDays!: number;

  @ApiPropertyOptional({ nullable: true })
  pendingPlanId!: string | null;

  @ApiProperty({ enum: ['NONE', 'SCHEDULED'] })
  upgradeStatus!: SubscriptionUpgradeStatus;

  @ApiPropertyOptional({ type: Date, nullable: true })
  cancelledAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  cancellationReason!: string | null;

  @ApiProperty({ description: 'Decimal serialized as string, e.g. "99.00"' })
  initialPayment!: string;

  @ApiProperty()
  startedAt!: Date;

  @ApiProperty({ type: Date, nullable: true })
  nextBillingAt!: Date | null;

  @ApiProperty({ type: PlanResponseDto })
  plan!: PlanResponseDto;

  @ApiPropertyOptional({ type: PendingPlanSummaryDto, nullable: true })
  pendingPlan!: PendingPlanSummaryDto | null;

  @ApiProperty({
    type: [BillingRecordResponseDto],
    description: 'Recent billing rows (list: last 3; detail: last 50)',
  })
  recentBillingRecords!: BillingRecordResponseDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
