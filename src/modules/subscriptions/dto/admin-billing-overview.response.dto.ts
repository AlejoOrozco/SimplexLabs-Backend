import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BillingCycle, PlanCategory } from '@prisma/client';

export class AdminBillingCompanyDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class AdminBillingPlanDto {
  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  category!: PlanCategory | null;

  @ApiProperty({ description: 'Monthly price as decimal string' })
  priceMonthly!: string;

  @ApiPropertyOptional({ nullable: true })
  priceAnnual!: string | null;
}

export class AdminBillingSubscriptionDueDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({ enum: ['MONTHLY', 'ANNUAL'] })
  billingCycle!: BillingCycle;

  @ApiPropertyOptional({ type: Date, nullable: true })
  currentPeriodEnd!: Date | null;

  @ApiProperty({ type: AdminBillingCompanyDto })
  company!: AdminBillingCompanyDto;

  @ApiProperty({ type: AdminBillingPlanDto })
  plan!: AdminBillingPlanDto;
}

export class AdminBillingSubscriptionOverdueDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty({ enum: ['MONTHLY', 'ANNUAL'] })
  billingCycle!: BillingCycle;

  @ApiPropertyOptional({ type: Date, nullable: true })
  overdueSince!: Date | null;

  @ApiProperty({ type: AdminBillingCompanyDto })
  company!: AdminBillingCompanyDto;

  @ApiProperty({ type: AdminBillingPlanDto })
  plan!: AdminBillingPlanDto;
}

export class AdminBillingOverviewResponseDto {
  @ApiProperty()
  totalMrr!: number;

  @ApiProperty()
  activeSubscriptions!: number;

  @ApiProperty({ type: [AdminBillingSubscriptionDueDto] })
  dueSoon!: AdminBillingSubscriptionDueDto[];

  @ApiProperty({ type: [AdminBillingSubscriptionOverdueDto] })
  overdue!: AdminBillingSubscriptionOverdueDto[];
}
