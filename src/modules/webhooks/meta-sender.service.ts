import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import { Channel } from '@prisma/client';
import type { MetaConfig } from '../../config/configuration';
import { ChannelsService } from '../channels/channels.service';
import { RetryPolicyService } from '../../common/reliability/retry-policy.service';
import { classifyMetaError } from '../../common/reliability/retry-classifiers';

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
 * operations. Stateless per-call: every send resolves the owning
 * company's phone_number_id + encrypted access token from the
 * `company_channels` table. No global access token is consulted.
 *
 * The API version is the only config value left — it's app-level, not
 * tenant-level, so it stays in env.
 */
@Injectable()
export class MetaSenderService {
  private readonly logger = new Logger(MetaSenderService.name);
  private readonly http: AxiosInstance;
  private readonly apiVersion: string;

  constructor(
    private readonly config: ConfigService,
    private readonly channels: ChannelsService,
    private readonly retry: RetryPolicyService,
  ) {
    const meta = this.config.getOrThrow<MetaConfig>('meta');
    this.apiVersion = meta.apiVersion;

    this.http = axios.create({
      baseURL: 'https://graph.facebook.com',
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Send a plain-text WhatsApp message on behalf of `companyId`. The
   * company's WhatsApp channel must be registered in `company_channels`
   * with a valid encrypted access token. Throws if no matching channel
   * exists — the caller (agent pipeline) decides whether to escalate or
   * drop.
   */
  async sendWhatsappText(
    companyId: string,
    recipientPhone: string,
    text: string,
  ): Promise<void> {
    const credentials = await this.channels.getSendingCredentials(
      companyId,
      Channel.WHATSAPP,
    );
    if (!credentials) {
      throw new NotFoundException(
        `No active WhatsApp channel configured for company ${companyId}`,
      );
    }

    const url = `/${this.apiVersion}/${credentials.externalId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: { body: text },
    };

    try {
      const result = await this.retry.run(
        {
          operation: `meta.sendWhatsappText(company=${companyId})`,
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 4_000,
          classify: classifyMetaError,
        },
        () =>
          this.http.post<MetaSendResponse>(url, body, {
            headers: { Authorization: `Bearer ${credentials.accessToken}` },
          }),
      );

      const messageId = result.value.data.messages?.[0]?.id ?? 'unknown';
      this.logger.log(
        `WhatsApp text sent company=${companyId} to=${recipientPhone} phone_number_id=${credentials.externalId} meta_message_id=${messageId} attempts=${result.attempts}`,
      );
    } catch (error) {
      const context = this.describeError(error);
      this.logger.error(
        `Failed to send WhatsApp text company=${companyId} to=${recipientPhone} phone_number_id=${credentials.externalId}: ${context}`,
      );
      throw new InternalServerErrorException(
        `Meta sendWhatsappText failed: ${context}`,
      );
    }
  }

  /**
   * Mark an inbound WhatsApp message as read. Read receipts are
   * non-critical — failures log at warn level and return normally so the
   * agent flow is never blocked on a cosmetic concern.
   */
  async markWhatsappAsRead(
    companyId: string,
    metaMessageId: string,
  ): Promise<void> {
    const credentials = await this.channels.getSendingCredentials(
      companyId,
      Channel.WHATSAPP,
    );
    if (!credentials) {
      this.logger.warn(
        `markWhatsappAsRead skipped: no active WhatsApp channel for company ${companyId}`,
      );
      return;
    }

    const url = `/${this.apiVersion}/${credentials.externalId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: metaMessageId,
    };

    try {
      await this.http.post(url, body, {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      });
    } catch (error) {
      const context = this.describeError(error);
      this.logger.warn(
        `markWhatsappAsRead failed company=${companyId} meta_message_id=${metaMessageId} phone_number_id=${credentials.externalId}: ${context}`,
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
