import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle, SubStatus } from '@prisma/client';

export class UpdateCompanySubscriptionDto {
  @ApiPropertyOptional({ enum: SubStatus })
  @IsEnum(SubStatus)
  @IsOptional()
  status?: SubStatus;

  @ApiPropertyOptional({ enum: BillingCycle })
  @IsEnum(BillingCycle)
  @IsOptional()
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ nullable: true })
  @IsNumber()
  @Min(0)
  @IsOptional()
  initialPayment?: number | null;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startedAt?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsDateString()
  @IsOptional()
  nextBillingAt?: string | null;
}
