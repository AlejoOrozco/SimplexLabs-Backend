import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MetaWebhookPayload, isMetaWebhookPayload } from './webhooks.types';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    // Injected now so that Phase 2 can persist conversations/messages
    // without changing the module wiring.
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    void this.prisma;
  }

  /**
   * Handshake Meta runs once when subscribing a webhook. Returns the
   * challenge string when the token matches, or `null` to signal a
   * verification failure (the controller turns this into a 403).
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
   * Ingest a Meta event. Phase 2 will write to `conversations` and
   * `messages`; for now we narrow and log so no payload is lost.
   *
   * NOTE: Meta will retry on any non-2xx response, so this method MUST NOT
   * throw on bad input — we log and acknowledge.
   */
  handleMetaEvent(payload: unknown): void {
    if (!isMetaWebhookPayload(payload)) {
      this.logger.warn(
        `Meta webhook received with unrecognized shape: ${safeStringify(
          payload,
        )}`,
      );
      return;
    }

    const typed: MetaWebhookPayload = payload;
    this.logger.log(
      `Meta webhook received: object=${typed.object} entries=${typed.entry.length}`,
    );
    this.logger.debug(safeStringify(typed));
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable payload]';
  }
}
