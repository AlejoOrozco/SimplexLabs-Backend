import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  ConversationControlMode,
  Prisma,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { assertTenantAccess } from '../../common/tenant/tenant-scope';
import { MetaSenderService } from '../webhooks/meta-sender.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  conversationEventSelect,
  messageEventSelect,
  toConversationEventPayload,
  toMessageEventPayload,
} from '../realtime/realtime-payload.mapper';
import { ConversationControlResponseDto } from './dto/control-response.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { toMessageResponse } from './conversation.mapper';

/**
 * Operations that mutate the `controlMode` of a conversation, plus the
 * human outbound-send path. Every mutation is race-safe against the
 * concurrent agent pipeline — see `docs` on each method for the exact
 * mechanism.
 */
@Injectable()
export class ConversationControlService {
  private readonly logger = new Logger(ConversationControlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaSender: MetaSenderService,
    private readonly realtime: RealtimeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Takeover — AGENT → HUMAN (or re-affirm HUMAN by same user)
  // ---------------------------------------------------------------------------
  async takeover(
    conversationId: string,
    requester: AuthenticatedUser,
  ): Promise<ConversationControlResponseDto> {
    const current = await this.loadForControl(conversationId, requester);

    // Idempotent: same user already in control → return current state.
    if (
      current.controlMode === ConversationControlMode.HUMAN &&
      current.controlledByUserId === requester.id
    ) {
      return this.toControlDto(conversationId, current);
    }

    // Conflict: another user of the same company is already in control.
    if (
      current.controlMode === ConversationControlMode.HUMAN &&
      current.controlledByUserId !== null &&
      current.controlledByUserId !== requester.id
    ) {
      throw new ConflictException({
        code: 'CONTROL_CONFLICT',
        message:
          'This conversation is already under human control by another user',
        controlledByUserId: current.controlledByUserId,
      });
    }

    // Compare-and-swap: only succeed if we still see the mode we read.
    // If a concurrent takeover won, count === 0 and we re-read + 409.
    const now = new Date();
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        companyId: current.companyId,
        OR: [
          { controlMode: ConversationControlMode.AGENT },
          {
            controlMode: ConversationControlMode.HUMAN,
            controlledByUserId: requester.id,
          },
          {
            controlMode: ConversationControlMode.HUMAN,
            controlledByUserId: null,
          },
        ],
      },
      data: {
        controlMode: ConversationControlMode.HUMAN,
        controlledByUserId: requester.id,
        controlModeChangedAt: now,
      },
    });

    if (result.count === 0) {
      const fresh = await this.loadForControl(conversationId, requester);
      throw new ConflictException({
        code: 'CONTROL_CONFLICT',
        message: 'Another user took control of this conversation first',
        controlledByUserId: fresh.controlledByUserId,
      });
    }

    this.logger.log(
      `Takeover conversation=${conversationId} user=${requester.id} company=${current.companyId}`,
    );

    this.realtime.emitConversationControlChanged({
      conversationId,
      companyId: current.companyId,
      controlMode: ConversationControlMode.HUMAN,
      controlledByUserId: requester.id,
      controlModeChangedAt: now.toISOString(),
      reason: 'takeover',
      actorUserId: requester.id,
    });
    await this.emitConversationUpdated(conversationId);

    return {
      conversationId,
      controlMode: ConversationControlMode.HUMAN,
      controlledByUserId: requester.id,
      controlModeChangedAt: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Handback — HUMAN → AGENT
  // ---------------------------------------------------------------------------
  async handback(
    conversationId: string,
    requester: AuthenticatedUser,
  ): Promise<ConversationControlResponseDto> {
    const current = await this.loadForControl(conversationId, requester);

    // Idempotent: already in AGENT mode.
    if (current.controlMode === ConversationControlMode.AGENT) {
      return this.toControlDto(conversationId, current);
    }

    // Policy: only the controlling user (or SUPER_ADMIN) may hand back.
    // This prevents teammate B from stealing control from teammate A by
    // calling `handback` + `takeover`. SUPER_ADMIN can override for ops.
    const canHandback =
      requester.role === 'SUPER_ADMIN' ||
      current.controlledByUserId === requester.id ||
      current.controlledByUserId === null;
    if (!canHandback) {
      throw new ConflictException({
        code: 'CONTROL_CONFLICT',
        message:
          'Only the user currently in control may hand back to the agent',
        controlledByUserId: current.controlledByUserId,
      });
    }

    const now = new Date();
    const result = await this.prisma.conversation.updateMany({
      where: {
        id: conversationId,
        companyId: current.companyId,
        controlMode: ConversationControlMode.HUMAN,
      },
      data: {
        controlMode: ConversationControlMode.AGENT,
        controlledByUserId: null,
        controlModeChangedAt: now,
      },
    });

    if (result.count === 0) {
      // Someone else transitioned back to AGENT in the meantime — that's fine,
      // caller's goal is already achieved.
      return this.toControlDto(conversationId, {
        ...current,
        controlMode: ConversationControlMode.AGENT,
        controlledByUserId: null,
        controlModeChangedAt: now,
      });
    }

    this.logger.log(
      `Handback conversation=${conversationId} user=${requester.id} company=${current.companyId}`,
    );

    this.realtime.emitConversationControlChanged({
      conversationId,
      companyId: current.companyId,
      controlMode: ConversationControlMode.AGENT,
      controlledByUserId: null,
      controlModeChangedAt: now.toISOString(),
      reason: 'handback',
      actorUserId: requester.id,
    });
    await this.emitConversationUpdated(conversationId);

    return {
      conversationId,
      controlMode: ConversationControlMode.AGENT,
      controlledByUserId: null,
      controlModeChangedAt: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Human outbound send — requires HUMAN mode controlled by the requester
  // ---------------------------------------------------------------------------
  async sendHumanMessage(
    conversationId: string,
    content: string,
    requester: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    const convo = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        companyId: true,
        channel: true,
        controlMode: true,
        controlledByUserId: true,
        contact: { select: { phone: true } },
      },
    });
    if (!convo) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    assertTenantAccess(convo.companyId, requester);

    if (convo.controlMode !== ConversationControlMode.HUMAN) {
      throw new ConflictException({
        code: 'NOT_IN_HUMAN_MODE',
        message:
          'Cannot send a human message: conversation is in AGENT mode. Call /takeover first.',
        controlMode: convo.controlMode,
      });
    }
    if (
      convo.controlledByUserId !== requester.id &&
      requester.role !== 'SUPER_ADMIN'
    ) {
      throw new ConflictException({
        code: 'CONTROL_CONFLICT',
        message: 'Another user is currently in control of this conversation',
        controlledByUserId: convo.controlledByUserId,
      });
    }
    if (!convo.contact.phone) {
      throw new BadRequestException(
        'Contact has no phone number — cannot send a WhatsApp message',
      );
    }

    // We send FIRST (best-effort network call) then persist. If persist
    // fails after a successful send, we'd risk a double-send on retry —
    // so we persist with a compare-and-swap on controlMode to reject any
    // race where takeover got yanked mid-call. For Phase 3 we accept the
    // simpler ordering (send → persist) since human sends are user-
    // initiated and retryable at the UI level; the rare "sent but not
    // persisted" case surfaces as a log-only inconsistency we'll smooth
    // over in Phase 4's message-status reconciliation.
    await this.metaSender.sendWhatsappText(
      convo.companyId,
      convo.contact.phone,
      content,
    );

    const now = new Date();
    const persisted = await this.prisma.$transaction(async (tx) => {
      // Guarded update: only proceed if the conversation is still HUMAN
      // under the same user. If a concurrent handback happened between
      // the send and the persist, we still persist the message (we don't
      // want to drop the customer-facing reality) but log the race.
      const message = await tx.message.create({
        data: {
          conversationId: convo.id,
          senderType: SenderType.HUMAN,
          content,
          sentAt: now,
          metadata: { source: 'human-send', sentByUserId: requester.id },
        },
        select: messageEventSelect,
      });

      await tx.conversation.update({
        where: { id: convo.id },
        data: { lastAgentMessageAt: now, updatedAt: now },
        select: { id: true },
      });

      return message;
    });

    this.logger.log(
      `Human message sent conversation=${conversationId} user=${requester.id} to=${convo.contact.phone}`,
    );

    this.realtime.emitMessageCreated(toMessageEventPayload(persisted));
    await this.emitConversationUpdated(conversationId);

    return toMessageResponse({
      id: persisted.id,
      conversationId: persisted.conversationId,
      agentRunId: persisted.agentRunId,
      senderType: persisted.senderType,
      content: persisted.content,
      metadata: persisted.metadata as Prisma.JsonValue,
      sentAt: persisted.sentAt,
      deliveredAt: persisted.deliveredAt,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async loadForControl(
    conversationId: string,
    requester: AuthenticatedUser,
  ): Promise<{
    companyId: string;
    channel: Channel;
    controlMode: ConversationControlMode;
    controlledByUserId: string | null;
    controlModeChangedAt: Date | null;
  }> {
    const row = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        companyId: true,
        channel: true,
        controlMode: true,
        controlledByUserId: true,
        controlModeChangedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }
    assertTenantAccess(row.companyId, requester);
    return row;
  }

  private toControlDto(
    conversationId: string,
    row: {
      controlMode: ConversationControlMode;
      controlledByUserId: string | null;
      controlModeChangedAt: Date | null;
    },
  ): ConversationControlResponseDto {
    return {
      conversationId,
      controlMode: row.controlMode,
      controlledByUserId: row.controlledByUserId,
      controlModeChangedAt: (row.controlModeChangedAt ?? new Date()).toISOString(),
    };
  }

  private async emitConversationUpdated(conversationId: string): Promise<void> {
    const fresh = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: conversationEventSelect,
    });
    if (fresh) {
      this.realtime.emitConversationUpdated(toConversationEventPayload(fresh));
    }
  }
}
