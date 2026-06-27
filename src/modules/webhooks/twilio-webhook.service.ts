import { Injectable, Logger } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { ChannelsService } from '../channels/channels.service';
import { WebhooksService } from './webhooks.service';
import {
  normalizeTwilioWhatsAppAddress,
  twilioAddressToPhone,
} from './twilio-signature.util';

export interface TwilioWhatsAppInboundPayload {
  MessageSid: string;
  AccountSid: string;
  From: string;
  To: string;
  Body?: string;
  NumMedia?: string;
  ProfileName?: string;
  WaId?: string;
  SmsMessageSid?: string;
}

@Injectable()
export class TwilioWebhookService {
  private readonly logger = new Logger(TwilioWebhookService.name);

  constructor(
    private readonly channels: ChannelsService,
    private readonly webhooks: WebhooksService,
  ) {}

  /**
   * Ingest a Twilio WhatsApp inbound webhook. Twilio retries on non-2xx,
   * so callers must ACK quickly and swallow errors here.
   */
  async handleInbound(raw: Record<string, string>): Promise<void> {
    const payload: TwilioWhatsAppInboundPayload = {
      MessageSid: raw.MessageSid ?? '',
      AccountSid: raw.AccountSid ?? '',
      From: raw.From ?? '',
      To: raw.To ?? '',
      Body: raw.Body,
      NumMedia: raw.NumMedia,
      ProfileName: raw.ProfileName,
      WaId: raw.WaId,
      SmsMessageSid: raw.SmsMessageSid,
    };
    if (!payload.MessageSid || !payload.From || !payload.To) {
      this.logger.warn(
        `Twilio inbound missing required fields: ${safeStringify(payload)}`,
      );
      return;
    }

    const to = normalizeTwilioWhatsAppAddress(payload.To);
    const resolved = await this.channels.resolveCompanyByExternalId(
      Channel.WHATSAPP,
      to,
    );
    if (!resolved) {
      this.logger.warn(
        `No company mapped for Twilio To=${to} — dropping MessageSid=${payload.MessageSid}`,
      );
      return;
    }

    const numMedia = Number.parseInt(payload.NumMedia ?? '0', 10);
    const body = payload.Body?.trim() ?? '';
    const content =
      numMedia > 0 && !body
        ? '[Media received]'
        : body.length > 0
          ? body
          : '[Empty message received]';

    const metadata = toJsonValue({
      provider: 'twilio',
      metaMessageId: payload.MessageSid,
      twilioMessageSid: payload.MessageSid,
      twilioAccountSid: payload.AccountSid,
      profileName: payload.ProfileName ?? null,
      waId: payload.WaId ?? null,
      numMedia,
      rawTo: payload.To,
      rawFrom: payload.From,
    });

    await this.webhooks.ingestWhatsAppInbound({
      provider: 'twilio',
      providerEventId: payload.MessageSid,
      companyId: resolved.companyId,
      from: twilioAddressToPhone(payload.From),
      content,
      metadata,
      sentAt: new Date(),
    });
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable payload]';
  }
}
