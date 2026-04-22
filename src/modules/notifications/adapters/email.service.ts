import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import type { EmailConfig } from '../../../config/configuration';
import { RetryPolicyService } from '../../../common/reliability/retry-policy.service';
import { classifyEmailError } from '../../../common/reliability/retry-classifiers';

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

/**
 * Phase 6 email fallback. Deliberately minimal:
 *   - Plain-text only (no HTML, no remote images, no tracking pixels).
 *   - One provider: SMTP via nodemailer. `EMAIL_PROVIDER=none` disables
 *     delivery while keeping in-app + WhatsApp fully functional.
 *   - Never throws: the caller (NotificationsService) records a
 *     `NotificationDelivery` row for every attempt and must keep the
 *     in-app notification visible regardless of outbound success.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly cfg: EmailConfig;
  private readonly transporter: Transporter | null;

  constructor(
    config: ConfigService,
    private readonly retry: RetryPolicyService,
  ) {
    this.cfg = config.getOrThrow<EmailConfig>('email');
    this.transporter = this.buildTransporter();
  }

  isConfigured(): boolean {
    return this.transporter !== null && this.cfg.from.length > 0;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    if (!this.transporter) {
      return {
        success: false,
        providerRefId: null,
        error: 'email_provider_not_configured',
      };
    }
    if (!this.cfg.from) {
      return {
        success: false,
        providerRefId: null,
        error: 'email_from_not_configured',
      };
    }
    if (!params.to) {
      return {
        success: false,
        providerRefId: null,
        error: 'recipient_empty',
      };
    }

    const transporter = this.transporter;
    try {
      const { value: info } = await this.retry.run(
        {
          operation: 'email.send',
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
      const message =
        error instanceof Error ? error.message : 'unknown email error';
      // Never include params.to in logs to avoid leaking PII beyond the
      // audit trail we already persist in NotificationDelivery.
      this.logger.warn(`Email send failed: ${message}`);
      return {
        success: false,
        providerRefId: null,
        // Don't leak upstream stack traces to API consumers.
        error: message.slice(0, 300),
      };
    }
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
}
