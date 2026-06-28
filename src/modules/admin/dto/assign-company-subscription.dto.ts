import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle, SubStatus } from '@prisma/client';

export class AssignCompanySubscriptionDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiProperty({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;

  @ApiPropertyOptional({ enum: SubStatus, default: 'ACTIVE' })
  @IsEnum(SubStatus)
  @IsOptional()
  status?: SubStatus;

  @ApiPropertyOptional({ nullable: true })
  @IsNumber()
  @Min(0)
  @IsOptional()
  initialPayment?: number | null;

  @ApiProperty()
  @IsDateString()
  startedAt!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsDateString()
  @IsOptional()
  nextBillingAt?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, cancels the existing ACTIVE/PAUSED subscription in the same plan category before assigning.',
  })
  @IsBoolean()
  @IsOptional()
  replaceExisting?: boolean;
}
