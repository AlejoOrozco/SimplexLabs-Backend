import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class RecordSubscriptionPaymentDto {
  @ApiPropertyOptional({
    description: 'Existing billing row id (cuid). When omitted, a new row is created.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  billingRecordId?: string;

  @ApiPropertyOptional({ description: 'Override amount when creating a new billing row' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiProperty()
  @IsDateString()
  paidAt!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  paymentMethod!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
