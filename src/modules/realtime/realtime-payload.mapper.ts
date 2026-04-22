import { Prisma } from '@prisma/client';
import type {
  ConversationEventPayload,
  MessageCreatedPayload,
} from './realtime-events';

/**
 * Prisma select clauses chosen to produce the exact shape the UI needs
 * in realtime events, without over-fetching or leaking internal fields
 * (e.g. encrypted tokens, relation trees).
 */
export const conversationEventSelect = {
  id: true,
  companyId: true,
  contactId: true,
  channel: true,
  status: true,
  lifecycleStatus: true,
  controlMode: true,
  controlledByUserId: true,
  controlModeChangedAt: true,
  lastCustomerMessageAt: true,
  lastAgentMessageAt: true,
  createdAt: true,
  updatedAt: true,
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
    },
  },
} satisfies Prisma.ConversationSelect;

export type ConversationEventRow = Prisma.ConversationGetPayload<{
  select: typeof conversationEventSelect;
}>;

export const messageEventSelect = {
  id: true,
  conversationId: true,
  senderType: true,
  content: true,
  metadata: true,
  sentAt: true,
  deliveredAt: true,
  agentRunId: true,
  conversation: { select: { companyId: true } },
} satisfies Prisma.MessageSelect;

export type MessageEventRow = Prisma.MessageGetPayload<{
  select: typeof messageEventSelect;
}>;

export function toConversationEventPayload(
  row: ConversationEventRow,
): ConversationEventPayload {
  return {
    id: row.id,
    companyId: row.companyId,
    contactId: row.contactId,
    channel: row.channel,
    status: row.status,
    lifecycleStatus: row.lifecycleStatus,
    controlMode: row.controlMode,
    controlledByUserId: row.controlledByUserId,
    controlModeChangedAt: row.controlModeChangedAt?.toISOString() ?? null,
    lastCustomerMessageAt: row.lastCustomerMessageAt?.toISOString() ?? null,
    lastAgentMessageAt: row.lastAgentMessageAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    contact: {
      id: row.contact.id,
      firstName: row.contact.firstName,
      lastName: row.contact.lastName,
      phone: row.contact.phone,
      email: row.contact.email,
    },
  };
}

export function toMessageEventPayload(row: MessageEventRow): MessageCreatedPayload {
  return {
    id: row.id,
    conversationId: row.conversationId,
    companyId: row.conversation.companyId,
    senderType: row.senderType,
    content: row.content,
    metadata: row.metadata,
    sentAt: row.sentAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    agentRunId: row.agentRunId,
  };
}
