import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import type { MetaConfig } from '../../config/configuration';

interface MetaSendResponse {
  messaging_product: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
}

interface MetaApiErrorShape {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * Thin wrapper around Meta's WhatsApp Cloud Graph API for outbound
 * operations. Stateless and injectable so the future AgentsModule can
 * import it without knowing anything about axios or token handling.
 */
@Injectable()
export class MetaSenderService {
  private readonly logger = new Logger(MetaSenderService.name);
  private readonly http: AxiosInstance;
  private readonly apiVersion: string;
  private readonly accessToken: string;

  constructor(private readonly config: ConfigService) {
    const meta = this.config.getOrThrow<MetaConfig>('meta');
    this.apiVersion = meta.apiVersion;
    this.accessToken = meta.accessToken;

    this.http = axios.create({
      baseURL: 'https://graph.facebook.com',
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Send a plain-text WhatsApp message.
   *
   * Failures throw — the caller (agent pipeline) is expected to handle
   * retries / user-facing fallback. The original error is logged with
   * enough context to debug from Railway logs alone.
   */
  async sendTextMessage(
    phoneNumberId: string,
    recipientPhone: string,
    text: string,
  ): Promise<void> {
    this.assertAccessToken();

    const url = `/${this.apiVersion}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: { body: text },
    };

    try {
      const response = await this.http.post<MetaSendResponse>(url, body, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      const messageId = response.data.messages?.[0]?.id ?? 'unknown';
      this.logger.log(
        `WhatsApp text sent to ${recipientPhone} via phone_number_id=${phoneNumberId} meta_message_id=${messageId}`,
      );
    } catch (error) {
      const context = this.describeError(error);
      this.logger.error(
        `Failed to send WhatsApp text to ${recipientPhone} via ${phoneNumberId}: ${context}`,
      );
      throw new InternalServerErrorException(
        `Meta sendTextMessage failed: ${context}`,
      );
    }
  }

  /**
   * Mark an inbound message as read so the contact sees the blue ticks.
   * Read receipts are non-critical — failures are logged but never
   * surfaced to the caller, to avoid breaking the agent flow over a
   * cosmetic concern.
   */
  async markAsRead(
    phoneNumberId: string,
    metaMessageId: string,
  ): Promise<void> {
    if (!this.accessToken) {
      this.logger.warn(
        'META_ACCESS_TOKEN not configured — skipping markAsRead',
      );
      return;
    }

    const url = `/${this.apiVersion}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: metaMessageId,
    };

    try {
      await this.http.post(url, body, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
    } catch (error) {
      const context = this.describeError(error);
      this.logger.warn(
        `markAsRead failed for meta_message_id=${metaMessageId} via ${phoneNumberId}: ${context}`,
      );
    }
  }

  private assertAccessToken(): void {
    if (!this.accessToken) {
      throw new InternalServerErrorException(
        'META_ACCESS_TOKEN is not configured',
      );
    }
  }

  private describeError(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<MetaApiErrorShape>;
      const status = axiosError.response?.status ?? 'no-status';
      const metaError = axiosError.response?.data?.error;
      const metaMessage = metaError?.message ?? axiosError.message;
      const code = metaError?.code ?? 'n/a';
      const trace = metaError?.fbtrace_id ?? 'n/a';
      return `status=${status} code=${code} fbtrace_id=${trace} message="${metaMessage}"`;
    }
    if (error instanceof Error) return error.message;
    return 'unknown error';
  }
}
