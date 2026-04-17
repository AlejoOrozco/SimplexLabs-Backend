import {
  IsUUID,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty()
  @IsUUID()
  planId!: string;

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
