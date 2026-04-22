import { Injectable, Logger } from '@nestjs/common';
import { MetaSenderService } from '../../webhooks/meta-sender.service';

export interface WhatsappNotifySendParams {
  readonly companyId: string;
  readonly to: string;
  readonly text: string;
}

export interface WhatsappNotifySendResult {
  readonly success: boolean;
  readonly providerRefId: string | null;
  readonly error: string | null;
}

/**
 * Thin, notification-shaped wrapper over `MetaSenderService`.
 *
 * Exists so NotificationsService never talks to Meta directly — the same
 * deterministic `{ success, providerRefId, error }` shape is returned by
 * both channel adapters, which keeps the delivery policy loop in the
 * service layer trivially linear.
 *
 * Never throws; errors are shaped and logged. The caller persists every
 * attempt as a `NotificationDelivery` row regardless of outcome.
 */
@Injectable()
export class WhatsappNotificationAdapter {
  private readonly logger = new Logger(WhatsappNotificationAdapter.name);

  constructor(private readonly meta: MetaSenderService) {}

  async send(
    params: WhatsappNotifySendParams,
  ): Promise<WhatsappNotifySendResult> {
    if (!params.to) {
      return {
        success: false,
        providerRefId: null,
        error: 'recipient_empty',
      };
    }
    try {
      await this.meta.sendWhatsappText(
        params.companyId,
        params.to,
        params.text,
      );
      // MetaSenderService does not yet surface the provider message id
      // directly — it logs it. Phase 6 is scoped to track attempt+outcome,
      // not to refactor sender return shapes.
      return { success: true, providerRefId: null, error: null };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'unknown whatsapp error';
      this.logger.warn(
        `WhatsApp notification delivery failed company=${params.companyId}: ${message}`,
      );
      return {
        success: false,
        providerRefId: null,
        error: message.slice(0, 300),
      };
    }
  }
}
