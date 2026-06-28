import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle } from '@prisma/client';

export class SwapSubscriptionPlanDto {
  @ApiProperty()
  @IsUUID()
  planId!: string;

  @ApiPropertyOptional({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ nullable: true })
  @IsNumber()
  @Min(0)
  @IsOptional()
  initialPayment?: number | null;

  @ApiPropertyOptional({
    description: 'When omitted, the swap takes effect immediately.',
  })
  @IsDateString()
  @IsOptional()
  effectiveAt?: string;
}
