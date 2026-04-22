import type {
  Channel,
  ConversationControlMode,
  ConversationLifecycleStatus,
  ConvoStatus,
  NotificationType,
  SenderType,
} from '@prisma/client';

/**
 * Canonical event names. Kept as a const tuple so both server and the
 * frontend shared package (if extracted later) can reference the same
 * strings without drift.
 */
export const REALTIME_EVENTS = {
  CONVERSATION_CREATED: 'conversation.created',
  CONVERSATION_UPDATED: 'conversation.updated',
  CONVERSATION_CONTROL_CHANGED: 'conversation.control_changed',
  MESSAGE_CREATED: 'message.created',
  NOTIFICATION_CREATED: 'notification.created',
} as const;

export type RealtimeEventName =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

// -----------------------------------------------------------------------------
// Payload shapes — all events carry companyId so the client can assert the
// room membership; the gateway does NOT trust the server-side companyId field
// for authorization, it only uses it for debugging.
// -----------------------------------------------------------------------------

export interface ConversationEventContact {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
}

export interface ConversationEventPayload {
  id: string;
  companyId: string;
  contactId: string;
  channel: Channel;
  status: ConvoStatus;
  lifecycleStatus: ConversationLifecycleStatus;
  controlMode: ConversationControlMode;
  controlledByUserId: string | null;
  controlModeChangedAt: string | null;
  lastCustomerMessageAt: string | null;
  lastAgentMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: ConversationEventContact;
}

export interface ConversationControlChangedPayload {
  conversationId: string;
  companyId: string;
  controlMode: ConversationControlMode;
  controlledByUserId: string | null;
  controlModeChangedAt: string;
  /** Explicit reason for state change: takeover / handback / auto. */
  reason: 'takeover' | 'handback';
  /** Actor that caused the change (the user that took over / handed back). */
  actorUserId: string | null;
}

export interface MessageCreatedPayload {
  id: string;
  conversationId: string;
  companyId: string;
  senderType: SenderType;
  content: string;
  /** Opaque; may contain metaMessageId, source marker, etc. */
  metadata: unknown;
  sentAt: string;
  deliveredAt: string | null;
  /** Optional link to the AgentRun that produced an AGENT message. */
  agentRunId: string | null;
}

export interface NotificationCreatedPayload {
  id: string;
  companyId: string;
  conversationId: string | null;
  type: NotificationType;
  title: string;
  /** Short preview body; sensitive fields MUST NOT be included. */
  body: string;
  /** Opaque hint object for the dashboard to wire deep links. */
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export type RealtimeEventPayloadMap = {
  [REALTIME_EVENTS.CONVERSATION_CREATED]: ConversationEventPayload;
  [REALTIME_EVENTS.CONVERSATION_UPDATED]: ConversationEventPayload;
  [REALTIME_EVENTS.CONVERSATION_CONTROL_CHANGED]: ConversationControlChangedPayload;
  [REALTIME_EVENTS.MESSAGE_CREATED]: MessageCreatedPayload;
  [REALTIME_EVENTS.NOTIFICATION_CREATED]: NotificationCreatedPayload;
};

/**
 * Room name convention: all events are scoped to a single tenant.
 * The server NEVER emits anything to a socket that has not joined the
 * correct `company:{companyId}` room.
 */
export function companyRoom(companyId: string): string {
  return `company:${companyId}`;
}
