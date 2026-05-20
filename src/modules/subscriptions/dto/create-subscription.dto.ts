import {
  IsUUID,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle, PlanCategory } from '@prisma/client';

export class CreateSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({
    description:
      'When omitted, defaults to the plan category if the plan defines one.',
  })
  @IsEnum(PlanCategory)
  @IsOptional()
  category?: PlanCategory;

  @ApiPropertyOptional({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  initialPayment!: number;

  @ApiProperty()
  @IsDateString()
  startedAt!: string;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  nextBillingAt?: string;
}
