import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

export class PaymentEventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: PaymentStatus, nullable: true })
  prevStatus!: PaymentStatus | null;
  @ApiProperty({ enum: PaymentStatus })
  newStatus!: PaymentStatus;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  /**
   * Free-form metadata (Stripe event id, reviewer id, etc). NEVER
   * includes raw card data or tokens — Stripe never returns them here
   * and the wire flow does not touch payment instruments at all.
   */
  @ApiProperty({ type: Object, nullable: true })
  metadata!: Record<string, unknown> | null;
  @ApiProperty() createdAt!: Date;
}

export class PaymentContactSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() lastName!: string;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
}

export class PaymentOrderSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ description: 'Decimal serialized as string' }) amount!: string;
  @ApiProperty() productId!: string;
}

export class PaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() companyId!: string;
  @ApiProperty() contactId!: string;

  @ApiProperty({ type: String, nullable: true })
  orderId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  conversationId!: string | null;

  @ApiProperty({ enum: PaymentMethod }) method!: PaymentMethod;
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;

  @ApiProperty({ description: 'Decimal serialized as string' })
  amount!: string;

  @ApiProperty() currency!: string;

  /**
   * `checkoutUrl` is returned ONLY on the initiation response for Stripe,
   * never on list/detail reads (the URL becomes stale/irrelevant after
   * the session is paid/expired). The wire transfer path returns
   * `wireInstructions` instead.
   */
  @ApiPropertyOptional({ type: String })
  checkoutUrl?: string;

  @ApiPropertyOptional({ type: String })
  wireInstructions?: string;

  @ApiProperty({ type: String, nullable: true })
  wireScreenshotUrl!: string | null;

  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  @ApiPropertyOptional({ type: PaymentContactSummaryDto })
  contact?: PaymentContactSummaryDto;

  @ApiPropertyOptional({ type: PaymentOrderSummaryDto, nullable: true })
  order?: PaymentOrderSummaryDto | null;

  @ApiPropertyOptional({ type: [PaymentEventResponseDto] })
  events?: PaymentEventResponseDto[];
}
