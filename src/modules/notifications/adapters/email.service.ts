import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import type { EmailConfig } from '../../../config/configuration';
import { RetryPolicyService } from '../../../common/reliability/retry-policy.service';
import {
  classifyEmailError,
  classifyResendError,
} from '../../../common/reliability/retry-classifiers';

export interface EmailSendParams {
  readonly to: string;
  readonly subject: string;
  /** Plain-text body; we intentionally do not ship HTML for notification emails. */
  readonly text: string;
}

export interface EmailSendResult {
  readonly success: boolean;
  readonly providerRefId: string | null;
  readonly error: string | null;
}

class ResendApiError extends Error {
  readonly resendCode: string;

  constructor(message: string, resendCode: string) {
    super(message);
    this.name = 'ResendApiError';
    this.resendCode = resendCode;
  }
}

/**
 * Phase 6 email fallback. Deliberately minimal:
 *   - Plain-text only (no HTML, no remote images, no tracking pixels).
 *   - Providers: Resend HTTP API (`resend`) or SMTP via nodemailer (`smtp`).
 *     `EMAIL_PROVIDER=none` disables delivery while keeping in-app + WhatsApp
 *     fully functional.
 *   - Never throws: the caller (NotificationsService) records a
 *     `NotificationDelivery` row for every attempt and must keep the
 *     in-app notification visible regardless of outbound success.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly cfg: EmailConfig;
  private readonly transporter: Transporter | null;
  private readonly resend: Resend | null;

  constructor(
    config: ConfigService,
    private readonly retry: RetryPolicyService,
  ) {
    this.cfg = config.getOrThrow<EmailConfig>('email');
    this.transporter = this.buildTransporter();
    this.resend = this.buildResendClient();
  }

  isConfigured(): boolean {
    if (!this.cfg.from) return false;
    if (this.cfg.provider === 'resend') return this.resend !== null;
    if (this.cfg.provider === 'smtp') return this.transporter !== null;
    return false;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        providerRefId: null,
        error: 'email_provider_not_configured',
      };
    }
    if (!params.to) {
      return {
        success: false,
        providerRefId: null,
        error: 'recipient_empty',
      };
    }

    if (this.cfg.provider === 'resend') {
      return this.sendViaResend(params);
    }
    return this.sendViaSmtp(params);
  }

  private async sendViaResend(
    params: EmailSendParams,
  ): Promise<EmailSendResult> {
    const client = this.resend;
    if (!client) {
      return {
        success: false,
        providerRefId: null,
        error: 'email_provider_not_configured',
      };
    }

    try {
      const { value: response } = await this.retry.run(
        {
          operation: 'email.send.resend',
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 4_000,
          classify: classifyResendError,
        },
        async () => {
          const result = await client.emails.send({
            from: this.cfg.from,
            to: params.to,
            subject: params.subject,
            text: params.text,
          });
          if (result.error) {
            throw new ResendApiError(
              result.error.message,
              result.error.name,
            );
          }
          return result;
        },
      );
      return {
        success: true,
        providerRefId: response.data?.id ?? null,
        error: null,
      };
    } catch (error) {
      return this.toFailureResult(error);
    }
  }

  private async sendViaSmtp(params: EmailSendParams): Promise<EmailSendResult> {
    const transporter = this.transporter;
    if (!transporter) {
      return {
        success: false,
        providerRefId: null,
        error: 'email_provider_not_configured',
      };
    }

    try {
      const { value: info } = await this.retry.run(
        {
          operation: 'email.send.smtp',
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 4_000,
          classify: classifyEmailError,
        },
        () =>
          transporter.sendMail({
            from: this.cfg.from,
            to: params.to,
            subject: params.subject,
            text: params.text,
          }),
      );
      return {
        success: true,
        providerRefId: info.messageId ?? null,
        error: null,
      };
    } catch (error) {
      return this.toFailureResult(error);
    }
  }

  private toFailureResult(error: unknown): EmailSendResult {
    const message =
      error instanceof Error ? error.message : 'unknown email error';
    this.logger.warn(`Email send failed: ${message}`);
    return {
      success: false,
      providerRefId: null,
      error: message.slice(0, 300),
    };
  }

  private buildTransporter(): Transporter | null {
    if (this.cfg.provider !== 'smtp') return null;
    const { host, port, secure, user, password } = this.cfg.smtp;
    if (!host || !user || !password) {
      this.logger.warn(
        'EMAIL_PROVIDER=smtp but one of host/user/password is missing — email fallback disabled.',
      );
      return null;
    }
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass: password },
    });
  }

  private buildResendClient(): Resend | null {
    if (this.cfg.provider !== 'resend') return null;
    if (!this.cfg.resendApiKey) {
      this.logger.warn(
        'EMAIL_PROVIDER=resend but RESEND_API_KEY is missing — email fallback disabled.',
      );
      return null;
    }
    return new Resend(this.cfg.resendApiKey);
  }
}
