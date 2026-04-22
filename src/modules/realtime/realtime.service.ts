import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import {
  REALTIME_EVENTS,
  companyRoom,
  type ConversationControlChangedPayload,
  type ConversationEventPayload,
  type MessageCreatedPayload,
  type NotificationCreatedPayload,
  type RealtimeEventName,
  type RealtimeEventPayloadMap,
} from './realtime-events';

/**
 * Strongly-typed façade over the `RealtimeGateway`. Services should
 * depend on this class, not on the gateway directly, so call sites stay
 * decoupled from socket.io internals.
 *
 * All `emit*` methods:
 *   - Target ONLY the `company:{companyId}` room — no cross-tenant leakage.
 *   - Never throw. A failed emit should not block or revert the DB commit
 *     that produced the event; at worst the UI will reconcile on next
 *     fetch.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  emitConversationCreated(payload: ConversationEventPayload): void {
    this.emit(REALTIME_EVENTS.CONVERSATION_CREATED, payload.companyId, payload);
  }

  emitConversationUpdated(payload: ConversationEventPayload): void {
    this.emit(REALTIME_EVENTS.CONVERSATION_UPDATED, payload.companyId, payload);
  }

  emitConversationControlChanged(
    payload: ConversationControlChangedPayload,
  ): void {
    this.emit(
      REALTIME_EVENTS.CONVERSATION_CONTROL_CHANGED,
      payload.companyId,
      payload,
    );
  }

  emitMessageCreated(payload: MessageCreatedPayload): void {
    this.emit(REALTIME_EVENTS.MESSAGE_CREATED, payload.companyId, payload);
  }

  emitNotificationCreated(payload: NotificationCreatedPayload): void {
    this.emit(REALTIME_EVENTS.NOTIFICATION_CREATED, payload.companyId, payload);
  }

  private emit<E extends RealtimeEventName>(
    event: E,
    companyId: string,
    payload: RealtimeEventPayloadMap[E],
  ): void {
    try {
      const server = this.gateway.server;
      if (!server) {
        // Gateway not yet initialized — e.g. unit tests boot without
        // the socket adapter. Skip silently to keep caller paths clean.
        return;
      }
      server.to(companyRoom(companyId)).emit(event, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(
        `Realtime emit failed event=${event} company=${companyId}: ${message}`,
      );
    }
  }
}
