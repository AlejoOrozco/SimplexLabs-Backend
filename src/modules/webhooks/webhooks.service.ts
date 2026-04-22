import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Channel,
  ContactSource,
  ConversationControlMode,
  ConversationLifecycleStatus,
  ConvoStatus,
  Prisma,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { PipelineService } from '../agents/pipeline/pipeline.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WebhookDedupeService } from '../../common/reliability/webhook-dedupe.service';
import { FailedTaskService } from '../../common/reliability/failed-task.service';
import {
  logContext,
  runWithExtendedContext,
} from '../../common/observability/correlation-context';
import {
  conversationEventSelect,
  messageEventSelect,
  toConversationEventPayload,
  toMessageEventPayload,
} from '../realtime/realtime-payload.mapper';
import {
  META_OBJECT,
  MetaMessage,
  MetaStatus,
  MetaWebhookPayload,
  isMetaWebhookPayload,
} from './webhooks.types';

/**
 * Text used as stored `content` when the inbound message is non-text
 * (image / audio / document / etc.). The raw Meta media object is
 * preserved in `message.metadata` so the agent layer can render or
 * download it later.
 */
const NON_TEXT_CONTENT = {
  image: '[Image received]',
  audio: '[Audio received]',
  document: '[Document received]',
  video: '[Video received]',
  sticker: '[Sticker received]',
  location: '[Location received]',
  contacts: '[Contact card received]',
  interactive: '[Interactive reply received]',
  button: '[Button reply received]',
} as const;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly channels: ChannelsService,
    @Inject(forwardRef(() => PipelineService))
    private readonly pipeline: PipelineService,
    private readonly realtime: RealtimeService,
    private readonly dedupe: WebhookDedupeService,
    private readonly failedTasks: FailedTaskService,
  ) {}

  /**
   * Handshake Meta runs once when subscribing a webhook. Returns the
   * challenge string when mode + token match, or `null` so the
   * controller can respond with 403.
   *
   * The verify token remains a single global secret because Meta uses
   * one verify token per subscribed app — this is NOT per-tenant.
   */
  verifyWebhook(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string | null {
    const expected = this.config.get<string>('meta.webhookVerifyToken');

    if (!expected) {
      this.logger.error(
        'META_WEBHOOK_VERIFY_TOKEN is not configured — rejecting verification',
      );
      return null;
    }

    if (mode === 'subscribe' && token === expected && challenge) {
      return challenge;
    }
    return null;
  }

  /**
   * Ingest a Meta event. Meta retries on any non-2xx response, so this
   * method MUST NOT throw — every branch logs and acknowledges. The
   * controller has already returned 200 by the time this runs.
   */
  async handleMetaEvent(payload: unknown): Promise<void> {
    if (!isMetaWebhookPayload(payload)) {
      this.logger.warn(
        `Meta webhook received with unrecognized shape: ${safeStringify(payload)}`,
      );
      return;
    }

    const channel = this.resolveChannel(payload.object);
    if (!channel) {
      this.logger.warn(
        `Meta webhook object "${payload.object}" not mapped to a Channel — skipping`,
      );
      return;
    }

    for (const entry of payload.entry) {
      for (const change of entry.changes ?? []) {
        try {
          await this.handleChange(channel, change.value);
        } catch (error) {
          this.logger.error(
            `Failed to process Meta change (field=${change.field}): ${describeError(error)}`,
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal processing
  // ---------------------------------------------------------------------------

  private async handleChange(
    channel: Channel,
    value: MetaWebhookPayload['entry'][number]['changes'][number]['value'],
  ): Promise<void> {
    const externalId = value.metadata?.phone_number_id;

    if (value.statuses && value.statuses.length > 0) {
      for (const status of value.statuses) {
        await this.handleStatus(status);
      }
    }

    if (value.messages && value.messages.length > 0) {
      if (!externalId) {
        this.logger.warn(
          `Meta ${channel} change missing phone_number_id — dropping ${value.messages.length} message(s)`,
        );
        return;
      }

      const resolved = await this.channels.resolveCompanyByExternalId(
        channel,
        externalId,
      );
      if (!resolved) {
        this.logger.warn(
          `No active CompanyChannel for (channel=${channel}, externalId=${externalId}) — dropping ${value.messages.length} message(s)`,
        );
        return;
      }

      for (const message of value.messages) {
        await this.handleIncomingMessage(resolved.companyId, channel, message);
      }
    }
  }

  private async handleIncomingMessage(
    companyId: string,
    channel: Channel,
    message: MetaMessage,
  ): Promise<void> {
    // Phase 8 idempotency choke-point. CLAIM-OR-SKIP on the dedicated
    // `webhook_events` table: a concurrent retry loses the unique-index
    // race and short-circuits before any business write. This replaces
    // the previous app-level `findFirst` which had a race window.
    const providerKey = `meta:${channel.toLowerCase()}`;
    const claim = await this.dedupe.claim({
      provider: providerKey,
      providerEventId: message.id,
      companyId,
    });
    if (!claim.claimed) {
      this.logger.log(
        `Duplicate inbound meta_id=${message.id} provider=${providerKey} — claim skipped (existing=${claim.existingId})`,
      );
      return;
    }

    try {
      const contact = await this.findOrCreateContact(
        companyId,
        channel,
        message.from,
      );

      const conversation = await this.findOrCreateOpenConversation(
        companyId,
        contact.id,
        channel,
      );

      const { content, metadata } = this.extractMessageBody(message);
      // When the new conversation was opened because the previous one was
      // CLOSED, we stamp the pointer on the FIRST inbound message so
      // downstream phases can walk the history without a schema change.
      const enrichedMetadata =
        conversation.created && conversation.previousConversationId
          ? toJsonValue({
              ...(metadata as Record<string, unknown>),
              previousConversationId: conversation.previousConversationId,
            })
          : metadata;
      const sentAt = metaTimestampToDate(message.timestamp);

      const [createdMessage] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: SenderType.CONTACT,
            content,
            sentAt,
            metadata: enrichedMetadata,
          },
          select: messageEventSelect,
        }),
        this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastCustomerMessageAt: sentAt },
          select: { id: true },
        }),
      ]);

      this.logger.log(
        `Stored inbound ${channel} message meta_id=${message.id} conversation=${conversation.id} contact=${contact.id} company=${companyId}${
          conversation.previousConversationId
            ? ` (reopened from closed=${conversation.previousConversationId})`
            : ''
        }`,
      );

      // Emit realtime events AFTER the commit — order matters for the
      // dashboard UX: conversation.created (if applicable) must land
      // before the message.created for that conversation, so the UI can
      // create the thread container before rendering the first bubble.
      if (conversation.created) {
        const fresh = await this.prisma.conversation.findUnique({
          where: { id: conversation.id },
          select: conversationEventSelect,
        });
        if (fresh) {
          this.realtime.emitConversationCreated(toConversationEventPayload(fresh));
        }
      }
      this.realtime.emitMessageCreated(toMessageEventPayload(createdMessage));

      // Fire-and-forget pipeline execution. We do not await here — the
      // controller has already ACKed, and PipelineService is itself
      // resilient (it persists a failed AgentRun and returns normally
      // on any internal error). The extended correlation context carries
      // companyId / conversationId / messageId into every pipeline log.
      const messageId = createdMessage.id;
      void runWithExtendedContext(
        { companyId, conversationId: conversation.id, messageId },
        () =>
          this.pipeline
            .run({
              companyId,
              conversationId: conversation.id,
              messageId,
              channel,
              inbound: {
                content,
                metaMessageId: message.id,
                from: message.from,
              },
            })
            .then(() => undefined)
            .catch(async (error) => {
              this.logger.error(
                `Unexpected pipeline error ${logContext()} meta_id=${message.id}: ${describeError(error)}`,
              );
              // The pipeline normally persists AgentRun(success=false) on
              // its own. If the error escaped the pipeline's own try/catch
              // (e.g. provider outage pre-AgentRun), capture to DLQ so an
              // operator can replay with the same inputs.
              try {
                await this.failedTasks.record({
                  companyId,
                  taskType: 'pipeline.run',
                  payload: {
                    companyId,
                    conversationId: conversation.id,
                    messageId,
                    channel,
                    inbound: {
                      content,
                      metaMessageId: message.id,
                      from: message.from,
                    },
                  },
                  error,
                  attempts: 1,
                });
              } catch (dlqError) {
                this.logger.error(
                  `Failed to record pipeline failure to DLQ: ${describeError(dlqError)}`,
                );
              }
            }),
      );

      await this.dedupe.markProcessed(claim.id, 'ingested');
    } catch (error) {
      this.logger.error(
        `Failed to ingest inbound ${channel} message ${logContext()} meta_id=${message.id} from=${message.from}: ${describeError(error)}`,
      );
      await this.dedupe.markFailed(claim.id, describeError(error));
    }
  }

  private async handleStatus(status: MetaStatus): Promise<void> {
    try {
      const existing = await this.prisma.message.findFirst({
        where: {
          metadata: {
            path: ['metaMessageId'],
            equals: status.id,
          },
        },
        select: { id: true },
      });

      if (!existing) {
        this.logger.warn(
          `Status "${status.status}" received for unknown meta_message_id=${status.id} — ignoring`,
        );
        return;
      }

      if (status.status === 'delivered') {
        await this.prisma.message.update({
          where: { id: existing.id },
          data: { deliveredAt: metaTimestampToDate(status.timestamp) },
          select: { id: true },
        });
        this.logger.log(
          `Marked message ${existing.id} as delivered (meta_id=${status.id})`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process status meta_id=${status.id} status=${status.status}: ${describeError(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers — contacts / conversations / payload extraction
  // ---------------------------------------------------------------------------

  private async findOrCreateContact(
    companyId: string,
    channel: Channel,
    phone: string,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.clientContact.findFirst({
      where: { companyId, phone },
      select: { id: true },
    });
    if (existing) return existing;

    const created = await this.prisma.clientContact.create({
      data: {
        companyId,
        phone,
        firstName: phone,
        lastName: '',
        source: channelToContactSource(channel),
      },
      select: { id: true },
    });

    this.logger.log(
      `Created ClientContact ${created.id} for phone=${phone} company=${companyId}`,
    );
    return created;
  }

  /**
   * Enforce "at most one open conversation per (contactId, channel)" at
   * the service layer now that the DB-level hard unique was removed. The
   * non-unique composite index `(contactId, channel, status)` keeps this
   * lookup fast while allowing multiple historical CLOSED conversations
   * per contact on the same channel.
   */
  /**
   * Returns the live conversation to attach inbound to, plus a flag
   * describing whether we created it fresh (and if so, the id of the
   * CLOSED predecessor for history linkage).
   */
  private async findOrCreateOpenConversation(
    companyId: string,
    contactId: string,
    channel: Channel,
  ): Promise<{
    id: string;
    created: boolean;
    previousConversationId: string | null;
  }> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        companyId,
        contactId,
        channel,
        status: { not: ConvoStatus.CLOSED },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { id: existing.id, created: false, previousConversationId: null };
    }

    // No live thread — look for the most recent CLOSED one so we can
    // stamp the reopen linkage on the new conversation's first message.
    const closed = await this.prisma.conversation.findFirst({
      where: {
        companyId,
        contactId,
        channel,
        status: ConvoStatus.CLOSED,
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });

    const created = await this.prisma.conversation.create({
      data: {
        companyId,
        contactId,
        channel,
        status: ConvoStatus.OPEN,
        lifecycleStatus: ConversationLifecycleStatus.NEW,
        controlMode: ConversationControlMode.AGENT,
      },
      select: { id: true },
    });

    this.logger.log(
      `Created Conversation ${created.id} for contact=${contactId} channel=${channel} company=${companyId}${
        closed ? ` (reopened from closed=${closed.id})` : ''
      }`,
    );
    return {
      id: created.id,
      created: true,
      previousConversationId: closed?.id ?? null,
    };
  }

  private extractMessageBody(message: MetaMessage): {
    content: string;
    metadata: Prisma.InputJsonValue;
  } {
    const base = {
      metaMessageId: message.id,
      metaType: message.type,
    };

    if (message.type === 'text' && message.text?.body) {
      return {
        content: message.text.body,
        metadata: toJsonValue(base),
      };
    }

    if (message.type === 'image' && message.image) {
      return {
        content: NON_TEXT_CONTENT.image,
        metadata: toJsonValue({ ...base, image: message.image }),
      };
    }

    if (message.type === 'audio' && message.audio) {
      return {
        content: NON_TEXT_CONTENT.audio,
        metadata: toJsonValue({ ...base, audio: message.audio }),
      };
    }

    if (message.type === 'document' && message.document) {
      return {
        content: NON_TEXT_CONTENT.document,
        metadata: toJsonValue({ ...base, document: message.document }),
      };
    }

    if (message.type === 'video' && message.video) {
      return {
        content: NON_TEXT_CONTENT.video,
        metadata: toJsonValue({ ...base, video: message.video }),
      };
    }

    if (message.type === 'interactive' && message.interactive) {
      const reply =
        message.interactive.button_reply ?? message.interactive.list_reply;
      return {
        content: reply?.title ?? NON_TEXT_CONTENT.interactive,
        metadata: toJsonValue({ ...base, interactive: message.interactive }),
      };
    }

    this.logger.warn(
      `Unhandled Meta message type=${message.type} meta_id=${message.id} — storing raw payload`,
    );
    return {
      content: `[${message.type} received]`,
      metadata: toJsonValue({ ...base, raw: message }),
    };
  }

  private resolveChannel(object: string): Channel | null {
    switch (object) {
      case META_OBJECT.WHATSAPP:
        return Channel.WHATSAPP;
      case META_OBJECT.INSTAGRAM:
        return Channel.INSTAGRAM;
      case META_OBJECT.MESSENGER:
        return Channel.MESSENGER;
      default:
        return null;
    }
  }
}

// -----------------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------------

function channelToContactSource(channel: Channel): ContactSource {
  switch (channel) {
    case Channel.WHATSAPP:
      return ContactSource.WHATSAPP;
    case Channel.INSTAGRAM:
      return ContactSource.INSTAGRAM;
    case Channel.MESSENGER:
      return ContactSource.MESSENGER;
  }
}

function metaTimestampToDate(timestamp: string): Date {
  const seconds = Number.parseInt(timestamp, 10);
  if (Number.isNaN(seconds)) return new Date();
  return new Date(seconds * 1000);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable payload]';
  }
}

/**
 * Serialize → parse to guarantee the result is structurally a
 * `Prisma.InputJsonValue` (no functions, no `undefined`, no class
 * instances). This avoids leaking TypeScript structural types into
 * Prisma's strict Json input shape without resorting to `as` casts.
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return safeStringify(error);
}
