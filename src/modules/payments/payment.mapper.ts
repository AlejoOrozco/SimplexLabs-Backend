import { Prisma } from '@prisma/client';
import {
  PaymentEventResponseDto,
  PaymentResponseDto,
} from './dto/payment-response.dto';

/**
 * Include map used on every Payment read so the mapper can produce a
 * consistent response shape. Kept narrow — no card data, no raw Stripe
 * objects; we expose the application's view of the payment, not the
 * provider's.
 */
export const paymentInclude = {
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
    },
  },
  order: {
    select: {
      id: true,
      status: true,
      amount: true,
      productId: true,
    },
  },
  events: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      prevStatus: true,
      newStatus: true,
      reason: true,
      metadata: true,
      createdAt: true,
    },
  },
} satisfies Prisma.PaymentInclude;

export type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: typeof paymentInclude;
}>;

export function toPaymentEventResponse(
  event: PaymentWithRelations['events'][number],
): PaymentEventResponseDto {
  return {
    id: event.id,
    prevStatus: event.prevStatus,
    newStatus: event.newStatus,
    reason: event.reason,
    metadata: event.metadata === null ? null : (event.metadata as Record<string, unknown>),
    createdAt: event.createdAt,
  };
}

export function toPaymentResponse(
  payment: PaymentWithRelations,
): PaymentResponseDto {
  return {
    id: payment.id,
    companyId: payment.companyId,
    contactId: payment.contactId,
    orderId: payment.orderId,
    conversationId: payment.conversationId,
    method: payment.method,
    status: payment.status,
    amount: payment.amount.toString(),
    currency: payment.currency,
    wireScreenshotUrl: payment.wireScreenshotUrl,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    contact: {
      id: payment.contact.id,
      firstName: payment.contact.firstName,
      lastName: payment.contact.lastName,
      phone: payment.contact.phone,
    },
    order: payment.order
      ? {
          id: payment.order.id,
          status: payment.order.status,
          amount: payment.order.amount.toString(),
          productId: payment.order.productId,
        }
      : null,
    events: payment.events.map(toPaymentEventResponse),
  };
}
