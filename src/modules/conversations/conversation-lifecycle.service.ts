import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationControlMode,
  ConversationLifecycleStatus,
  ConvoStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  conversationEventSelect,
  toConversationEventPayload,
} from '../realtime/realtime-payload.mapper';
import { canTransitionLifecycle } from './lifecycle-transitions';

/**
 * Centralized mutator for `Conversation.lifecycleStatus` so each feature
 * (pipeline, appointments, payments later, etc.) does not have to repeat the
 * same update + realtime-emit choreography.
 *
 * Emit-after-commit: we update the DB first and only emit a realtime event
 * once the write has succeeded. Silent no-op if the conversation is missing
 * (e.g. appointment outside a conversation context).
 */
@Injectable()
export class ConversationLifecycleService {
  private readonly logger = new Logger(ConversationLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Update lifecycle status for a conversation (if one is linked) and emit
   * `conversation.updated` so dashboards re-render status badges in real time.
   *
   * Accepts an optional Prisma transaction client so lifecycle transitions
   * can be composed into larger atomic writes (e.g. create-appointment +
   * update-conversation-lifecycle in a single tx).
   */
  async transition(
    conversationId: string | null | undefined,
    next: ConversationLifecycleStatus,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!conversationId) return;

    const db = tx ?? this.prisma;
    const current = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { lifecycleStatus: true },
    });
    if (!current) return;

    // Phase 8 transition grammar. Illegal jumps are logged and silently
    // dropped — we DO NOT throw here because lifecycle is a side-channel
    // of business flows (payment confirm, appointment book, pipeline
    // finish). Throwing would cascade into the primary operation. The
    // validation script asserts no-op behaviour separately.
    if (!canTransitionLifecycle(current.lifecycleStatus, next)) {
      this.logger.warn(
        `lifecycle.illegal_transition_dropped convo=${conversationId} from=${current.lifecycleStatus} to=${next}`,
      );
      return;
    }

    const updated = await db.conversation.updateMany({
      where: {
        id: conversationId,
        lifecycleStatus: current.lifecycleStatus,
      },
      data: { lifecycleStatus: next, updatedAt: new Date() },
    });
    if (updated.count === 0) return; // raced; already moved forward.

    if (tx) {
      // Realtime must reflect committed state. If we're inside a transaction
      // the caller is responsible for emitting after commit; just log.
      this.logger.debug(
        `Queued lifecycle transition convo=${conversationId} → ${next} (in tx)`,
      );
      return;
    }

    const fresh = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: conversationEventSelect,
    });
    if (fresh) {
      this.realtime.emitConversationUpdated(toConversationEventPayload(fresh));
    }
  }

  /**
   * Companion method for callers that DID run the update inside a tx and
   * now need the emit-after-commit side-effect. Idempotent and never throws.
   */
  async emitUpdated(conversationId: string): Promise<void> {
    const fresh = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: conversationEventSelect,
    });
    if (fresh) {
      this.realtime.emitConversationUpdated(toConversationEventPayload(fresh));
    }
  }

  /**
   * Idempotent auto-close used by the Phase 6 inactivity job.
   *
   * Atomic precondition (compare-and-swap):
   *   - status = OPEN
   *   - controlMode = AGENT (never auto-close a human-controlled thread)
   *   - lastCustomerMessageAt (or createdAt) older than `inactiveSinceBefore`
   *
   * Returns `true` when the row was transitioned, `false` when nothing
   * matched (already closed, taken over, or freshly active). Emits
   * `conversation.updated` only on a real transition so the dashboard
   * re-renders without flickering.
   */
  async autoCloseIfInactive(
    conversationId: string,
    inactiveSinceBefore: Date,
  ): Promise<boolean> {
    const now = new Date();
    const updated = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        status: ConvoStatus.OPEN,
        controlMode: ConversationControlMode.AGENT,
        lifecycleStatus: { not: ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE },
        OR: [
          { lastCustomerMessageAt: { lte: inactiveSinceBefore } },
          {
            lastCustomerMessageAt: null,
            createdAt: { lte: inactiveSinceBefore },
          },
        ],
      },
      data: {
        status: ConvoStatus.CLOSED,
        lifecycleStatus: ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
        updatedAt: now,
      },
    });
    if (updated.count === 0) {
      return false;
    }

    const fresh = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: conversationEventSelect,
    });
    if (fresh) {
      this.realtime.emitConversationUpdated(toConversationEventPayload(fresh));
    }
    this.logger.log(`Auto-closed conversation=${conversationId} (inactive)`);
    return true;
  }
}
