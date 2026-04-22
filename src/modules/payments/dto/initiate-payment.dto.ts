import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class InitiatePaymentDto {
  @ApiProperty({ format: 'uuid', description: 'Order to pay for.' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({
    enum: PaymentMethod,
    description:
      'Must match a method enabled in the company settings. Use STRIPE for a hosted checkout link or WIRE_TRANSFER for manual review.',
  })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /**
   * Phase 5 is single-price-per-order; we still let callers override the
   * charged amount (e.g. discounts) without mutating the Order row. If
   * omitted, we charge Order.amount × 1.
   */
  @ApiPropertyOptional({ example: 199.99 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  amount?: number;

  @ApiPropertyOptional({ example: 'USD', default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;
}
