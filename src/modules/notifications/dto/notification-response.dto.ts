import { ApiProperty } from '@nestjs/swagger';
import type {
  NotificationChannel,
  NotificationType,
} from '@prisma/client';

export class NotificationDeliveryResponseDto {
  @ApiProperty()
  readonly id!: string;

  @ApiProperty({ enum: ['IN_APP', 'WHATSAPP', 'EMAIL'] })
  readonly channel!: NotificationChannel;

  /**
   * Destination is intentionally opaque in the response contract because
   * it can be a phone/email — we expose it so operators can see where the
   * attempt went, but only tenant users can read it.
   */
  @ApiProperty()
  readonly destination!: string;

  @ApiProperty({ nullable: true, type: String })
  readonly sentAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  readonly failedAt!: string | null;

  @ApiProperty({ nullable: true, type: String })
  readonly errorMessage!: string | null;

  @ApiProperty({ nullable: true, type: String })
  readonly providerRefId!: string | null;

  @ApiProperty()
  readonly createdAt!: string;
}

export class NotificationResponseDto {
  @ApiProperty()
  readonly id!: string;

  @ApiProperty()
  readonly companyId!: string;

  @ApiProperty({ nullable: true, type: String })
  readonly conversationId!: string | null;

  @ApiProperty({
    enum: [
      'APPOINTMENT_REQUESTED',
      'PAYMENT_SCREENSHOT_RECEIVED',
      'AGENT_NEEDS_ATTENTION',
      'ORDER_PLACED',
      'PIPELINE_FAILED',
    ],
  })
  readonly type!: NotificationType;

  @ApiProperty()
  readonly title!: string;

  @ApiProperty()
  readonly body!: string;

  @ApiProperty({
    description:
      'Opaque payload for the dashboard to wire deep links / badges.',
    nullable: true,
    type: Object,
  })
  readonly payload!: unknown;

  @ApiProperty({ nullable: true, type: String })
  readonly readAt!: string | null;

  @ApiProperty()
  readonly createdAt!: string;

  @ApiProperty({ type: [NotificationDeliveryResponseDto] })
  readonly deliveries!: NotificationDeliveryResponseDto[];
}

export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  readonly items!: NotificationResponseDto[];

  @ApiProperty()
  readonly total!: number;

  @ApiProperty()
  readonly unreadCount!: number;
}
