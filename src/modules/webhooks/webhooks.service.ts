import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Channel,
  ContactSource,
  ConvoStatus,
  Prisma,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { MetaConfig } from '../../config/configuration';
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
  ) {}

  /**
   * Handshake Meta runs once when subscribing a webhook. Returns the
   * challenge string when mode + token match, or `null` so the
   * controller can respond with 403.
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
    const phoneNumberId = value.metadata?.phone_number_id;

    if (value.statuses && value.statuses.length > 0) {
      for (const status of value.statuses) {
        await this.handleStatus(status);
      }
    }

    if (value.messages && value.messages.length > 0) {
      const companyId = await this.resolveCompanyId(phoneNumberId, channel);
      if (!companyId) {
        this.logger.warn(
          `No company mapped for phone_number_id=${phoneNumberId ?? 'unknown'} — dropping ${value.messages.length} message(s)`,
        );
        return;
      }

      for (const message of value.messages) {
        await this.handleIncomingMessage(companyId, channel, message);
      }
    }
  }

  private async handleIncomingMessage(
    companyId: string,
    channel: Channel,
    message: MetaMessage,
  ): Promise<void> {
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

      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: SenderType.CONTACT,
          content,
          sentAt: metaTimestampToDate(message.timestamp),
          metadata,
        },
      });

      this.logger.log(
        `Stored inbound ${channel} message meta_id=${message.id} conversation=${conversation.id} contact=${contact.id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to ingest inbound ${channel} message meta_id=${message.id} from=${message.from}: ${describeError(error)}`,
      );
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

  private async findOrCreateOpenConversation(
    companyId: string,
    contactId: string,
    channel: Channel,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        companyId,
        contactId,
        channel,
        status: { not: ConvoStatus.CLOSED },
      },
      select: { id: true },
    });
    if (existing) return existing;

    const created = await this.prisma.conversation.create({
      data: {
        companyId,
        contactId,
        channel,
        status: ConvoStatus.OPEN,
      },
      select: { id: true },
    });

    this.logger.log(
      `Created Conversation ${created.id} for contact=${contactId} channel=${channel}`,
    );
    return created;
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

  /**
   * Map an inbound `phone_number_id` to a `companyId`. Phase 1: single
   * tenant, resolved via the global `META_WHATSAPP_PHONE_NUMBER_ID` +
   * the only Company row. Phase 2 (agents) will replace this with a
   * per-tenant lookup table.
   */
  private async resolveCompanyId(
    phoneNumberId: string | undefined,
    channel: Channel,
  ): Promise<string | null> {
    if (channel !== Channel.WHATSAPP) {
      const company = await this.prisma.company.findFirst({
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      return company?.id ?? null;
    }

    const configured =
      this.config.get<MetaConfig>('meta')?.whatsappPhoneNumberId;
    if (!configured || !phoneNumberId || configured !== phoneNumberId) {
      this.logger.warn(
        `phone_number_id=${phoneNumberId ?? 'unknown'} does not match META_WHATSAPP_PHONE_NUMBER_ID=${configured ?? 'unset'}`,
      );
      return null;
    }

    const company = await this.prisma.company.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return company?.id ?? null;
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
