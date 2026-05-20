import {
  IsEnum,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  IsInt,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  SubStatus,
  PlanCategory,
  BillingCycle,
  SubscriptionUpgradeStatus,
} from '@prisma/client';

export class UpdateSubscriptionDto {
  @ApiPropertyOptional({ enum: SubStatus })
  @IsEnum(SubStatus)
  @IsOptional()
  status?: SubStatus;

  @ApiPropertyOptional({ enum: PlanCategory })
  @IsEnum(PlanCategory)
  @IsOptional()
  category?: PlanCategory;

  @ApiPropertyOptional({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  currentPeriodStart?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  currentPeriodEnd?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  overdueSince?: string;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  gracePeriodDays?: number;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  pendingPlanId?: string;

  @ApiPropertyOptional({ enum: SubscriptionUpgradeStatus })
  @IsEnum(SubscriptionUpgradeStatus)
  @IsOptional()
  upgradeStatus?: SubscriptionUpgradeStatus;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  cancelledAt?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  cancellationReason?: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  nextBillingAt?: string;
}
