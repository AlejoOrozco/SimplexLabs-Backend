import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import type { DialogConfig } from '../../config/configuration';

export interface SendTextMessageParams {
  companyId: string;
  recipientPhone: string;
  text: string;
}

export interface MarkAsReadParams {
  companyId: string;
  metaMessageId: string;
}

interface Dialog360SendResponse {
  messages?: Array<{ id: string }>;
}

/**
 * Outbound WhatsApp via 360dialog. Credentials are resolved per company
 * from `dialog_api_key` / `dialog_base_url`, with env sandbox fallbacks.
 */
@Injectable()
export class MetaSenderService {
  private readonly logger = new Logger(MetaSenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async sendTextMessage(params: SendTextMessageParams): Promise<string | null> {
    const { apiKey, baseUrl } = await this.getCredentials(params.companyId);
    const to = normalizeRecipient(params.recipientPhone);

    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'D360-API-KEY': apiKey,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: params.text },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Failed to send message to ${to}: ${error}`);
        throw new InternalServerErrorException(
          `360dialog send failed: ${response.status}`,
        );
      }

      const data = (await response.json()) as Dialog360SendResponse;
      const messageId = data.messages?.[0]?.id ?? null;
      this.logger.log(`Message sent to ${to}, meta_id=${messageId}`);
      return messageId;
    } catch (error) {
      this.logger.error(
        `MetaSenderService.sendTextMessage error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async markAsRead(params: MarkAsReadParams): Promise<void> {
    const { apiKey, baseUrl } = await this.getCredentials(params.companyId);

    try {
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'D360-API-KEY': apiKey,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: params.metaMessageId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.warn(
          `Failed to mark message ${params.metaMessageId} as read: ${error}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to mark message ${params.metaMessageId} as read: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async getCredentials(
    companyId: string,
  ): Promise<{ apiKey: string; baseUrl: string }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { dialogApiKey: true, dialogBaseUrl: true },
    });

    const dialog = this.config.get<DialogConfig>('dialog');

    const apiKey =
      company?.dialogApiKey?.trim() ||
      dialog?.sandboxApiKey?.trim() ||
      '';

    const baseUrl =
      company?.dialogBaseUrl?.trim() ||
      dialog?.sandboxBaseUrl ||
      'https://waba-sandbox.360dialog.io';

    if (!apiKey) {
      throw new InternalServerErrorException(
        `No 360dialog API key configured for company ${companyId}`,
      );
    }

    return { apiKey, baseUrl: baseUrl.replace(/\/$/, '') };
  }
}

function normalizeRecipient(phone: string): string {
  return phone.replace(/\s/g, '').replace(/^\+/, '');
}
