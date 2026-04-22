import type { Prisma } from '@prisma/client';
import type {
  NotificationDeliveryResponseDto,
  NotificationResponseDto,
} from './dto/notification-response.dto';

/**
 * Prisma `include` used by every notification read path so list/detail
 * responses stay structurally identical and mappers never field-access
 * a missing relation at runtime.
 */
export const notificationInclude = {
  deliveries: {
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.NotificationInclude;

export type NotificationWithRelations = Prisma.NotificationGetPayload<{
  include: typeof notificationInclude;
}>;

export function toNotificationDeliveryResponse(
  row: NotificationWithRelations['deliveries'][number],
): NotificationDeliveryResponseDto {
  return {
    id: row.id,
    channel: row.channel,
    destination: row.destination,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    failedAt: row.failedAt ? row.failedAt.toISOString() : null,
    errorMessage: row.errorMessage,
    providerRefId: row.providerRefId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toNotificationResponse(
  row: NotificationWithRelations,
): NotificationResponseDto {
  return {
    id: row.id,
    companyId: row.companyId,
    conversationId: row.conversationId,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload ?? null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    deliveries: row.deliveries.map(toNotificationDeliveryResponse),
  };
}
