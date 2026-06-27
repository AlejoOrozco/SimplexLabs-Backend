import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import type { TwilioConfig } from '../../config/configuration';
import { ChannelsService } from '../channels/channels.service';
import {
  normalizeTwilioWhatsAppAddress,
  twilioAddressToPhone,
} from './twilio-signature.util';

export interface SendTextMessageParams {
  companyId: string;
  recipientPhone: string;
  text: string;
}

interface ResolvedTwilioCredentials {
  accountSid: string;
  authToken: string;
  from: string;
  source: 'company_channel' | 'env';
}

function maskAccountSid(accountSid: string): string {
  if (accountSid.length <= 8) return '***';
  return `${accountSid.slice(0, 4)}...${accountSid.slice(-4)}`;
}

export class WhatsAppOutboundNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhatsAppOutboundNotReadyError';
  }
}

/**
 * Outbound WhatsApp via Twilio Messages API. Credentials resolve from the
 * company's active WHATSAPP CompanyChannel row, falling back to global env.
 */
@Injectable()
export class WhatsAppSenderService {
  private readonly logger = new Logger(WhatsAppSenderService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly channels: ChannelsService,
  ) {}

  /**
   * Verifies Twilio credentials before any LLM work. Calls Twilio's
   * account endpoint — no message is sent and no OpenAI tokens are used.
   */
  async assertOutboundReady(companyId: string): Promise<void> {
    const creds = await this.resolveCredentials(companyId);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      const detail = body.slice(0, 300);
      this.logger.error(
        `Twilio preflight failed company=${companyId} source=${creds.source} accountSid=${maskAccountSid(creds.accountSid)} status=${response.status}: ${detail}`,
      );
      throw new WhatsAppOutboundNotReadyError(
        `Twilio credentials rejected for company ${companyId} (HTTP ${response.status})`,
      );
    }
  }

  async sendTextMessage(params: SendTextMessageParams): Promise<string | null> {
    const creds = await this.resolveCredentials(params.companyId);
    const to = normalizeTwilioWhatsAppAddress(params.recipientPhone);
    const body = new URLSearchParams({
      From: creds.from,
      To: to,
      Body: params.text,
    });

    const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
    const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString(
      'base64',
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Twilio send failed to=${to}: ${error}`);
        throw new InternalServerErrorException(
          `Twilio send failed: ${response.status}`,
        );
      }

      const data = (await response.json()) as { sid?: string };
      const messageSid = data.sid ?? null;
      this.logger.log(`WhatsApp sent to ${to}, sid=${messageSid}`);
      return messageSid;
    } catch (error) {
      this.logger.error(
        `WhatsAppSenderService.sendTextMessage error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  private async resolveCredentials(
    companyId: string,
  ): Promise<ResolvedTwilioCredentials> {
    const twilio = this.config.getOrThrow<TwilioConfig>('twilio');
    const channelCreds = await this.resolveCompanyChannel(companyId, twilio);

    if (channelCreds) {
      // Env vars are the source of truth for the platform Twilio account.
      // The DB row mainly supplies the outbound `from` number (externalId).
      // This avoids stale businessAccountId / authToken rows after .env updates.
      const accountSid =
        twilio.accountSid?.trim() ||
        channelCreds.businessAccountId?.trim() ||
        '';
      const authToken =
        twilio.authToken?.trim() || channelCreds.accessToken.trim() || '';
      const from = normalizeTwilioWhatsAppAddress(channelCreds.externalId);

      if (!accountSid || !authToken) {
        throw new InternalServerErrorException(
          `Incomplete Twilio credentials for company ${companyId}`,
        );
      }
      return { accountSid, authToken, from, source: 'company_channel' };
    }

    if (!twilio.accountSid || !twilio.authToken || !twilio.whatsappFrom) {
      throw new InternalServerErrorException(
        `No Twilio WhatsApp credentials configured for company ${companyId}`,
      );
    }

    return {
      accountSid: twilio.accountSid,
      authToken: twilio.authToken,
      from: normalizeTwilioWhatsAppAddress(twilio.whatsappFrom),
      source: 'env',
    };
  }

  /**
   * Pick the WHATSAPP channel row for outbound sends. Prefer the row whose
   * externalId matches TWILIO_WHATSAPP_FROM (the sandbox/prod sender).
   * Falling back to findFirst(oldest) caused stale 360dialog rows to win.
   */
  private async resolveCompanyChannel(
    companyId: string,
    twilio: TwilioConfig,
  ) {
    if (twilio.whatsappFrom) {
      const externalId = normalizeTwilioWhatsAppAddress(twilio.whatsappFrom);
      const bySender = await this.channels.getSendingCredentialsByExternalId(
        Channel.WHATSAPP,
        externalId,
      );
      if (bySender?.companyId === companyId) {
        return bySender;
      }
    }

    return this.channels.getSendingCredentials(companyId, Channel.WHATSAPP);
  }
}

/** @deprecated Use twilioAddressToPhone — kept for callers migrating from Meta. */
export function normalizeRecipientPhone(phone: string): string {
  return twilioAddressToPhone(phone);
}
