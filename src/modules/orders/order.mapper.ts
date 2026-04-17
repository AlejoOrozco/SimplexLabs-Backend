import { Prisma } from '@prisma/client';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderStatusHistoryEntryDto } from './dto/order-status-history.dto';

export const orderInclude = {
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  product: {
    select: {
      id: true,
      name: true,
      type: true,
      price: true,
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{
  include: typeof orderInclude;
}>;

export const orderHistoryInclude = {
  changedBy: {
    select: { id: true, firstName: true, lastName: true },
  },
} satisfies Prisma.OrderStatusHistoryInclude;

export type OrderStatusHistoryWithUser = Prisma.OrderStatusHistoryGetPayload<{
  include: typeof orderHistoryInclude;
}>;

export function toOrderResponse(order: OrderWithRelations): OrderResponseDto {
  return {
    id: order.id,
    companyId: order.companyId,
    contactId: order.contactId,
    productId: order.productId,
    status: order.status,
    amount: order.amount.toString(),
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    contact: {
      id: order.contact.id,
      firstName: order.contact.firstName,
      lastName: order.contact.lastName,
      email: order.contact.email,
      phone: order.contact.phone,
    },
    product: {
      id: order.product.id,
      name: order.product.name,
      type: order.product.type,
      price: order.product.price.toString(),
    },
  };
}

export function toOrderHistoryEntry(
  entry: OrderStatusHistoryWithUser,
): OrderStatusHistoryEntryDto {
  return {
    id: entry.id,
    prevStatus: entry.prevStatus,
    newStatus: entry.newStatus,
    reason: entry.reason,
    createdAt: entry.createdAt,
    changedBy: {
      id: entry.changedBy.id,
      firstName: entry.changedBy.firstName,
      lastName: entry.changedBy.lastName,
    },
  };
}
