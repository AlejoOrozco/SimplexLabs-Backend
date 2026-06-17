import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Niche, SubStatus } from '@prisma/client';

export class AdminCompanySubscriptionSummaryDto {
  @ApiProperty({ description: 'Display name of the plan on the primary active subscription' })
  planName!: string;

  @ApiProperty({ enum: SubStatus })
  status!: SubStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'ISO-8601 next billing instant when scheduled',
  })
  nextBillingDate!: string | null;
}

export class AdminCompanyPrimaryAdminDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  isActive!: boolean;
}

export class AdminCompanyListRowDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: Niche })
  niche!: Niche;

  @ApiProperty({ description: 'True when this row is the SimplexLabs platform owner tenant' })
  isPlatformOwner!: boolean;

  @ApiProperty({
    description:
      'Company tenant flag from `companies.is_active` (admin deactivation)',
  })
  isActive!: boolean;

  @ApiProperty({
    description:
      'Company is active and has at least one active platform user in any role',
  })
  isOperational!: boolean;

  @ApiPropertyOptional({
    type: () => AdminCompanySubscriptionSummaryDto,
    nullable: true,
    description: 'Primary ACTIVE subscription for the company (most recent first)',
  })
  subscription!: AdminCompanySubscriptionSummaryDto | null;

  @ApiPropertyOptional({
    type: () => AdminCompanyPrimaryAdminDto,
    nullable: true,
    description: 'First active COMPANY_ADMIN for the tenant, when one exists',
  })
  primaryAdmin!: AdminCompanyPrimaryAdminDto | null;

  @ApiProperty({ description: 'Conversation count rollup for admin dashboards' })
  totalConversations!: number;

  @ApiProperty({ description: 'Order count rollup for admin dashboards' })
  totalOrders!: number;
}
