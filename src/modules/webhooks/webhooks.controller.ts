import {
  Body,
  Controller,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { TwilioSignatureGuard } from './twilio-signature.guard';
import { TwilioWebhookService } from './twilio-webhook.service';

/**
 * Twilio webhook endpoints. These do NOT go through the standard
 * `ResponseInterceptor` envelope because Twilio expects a plain XML ack
 * within a few seconds or it will retry.
 */
@ApiTags('Webhooks')
@Controller('webhooks')
@SkipThrottle()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly twilioWebhookService: TwilioWebhookService) {}

  @Post('twilio/whatsapp')
  @UseGuards(TwilioSignatureGuard)
  @RawResponse()
  @ApiOperation({ summary: 'Receive Twilio WhatsApp webhook events' })
  @ApiExcludeEndpoint()
  receiveTwilioWhatsApp(@Body() payload: unknown, @Res() res: Response): void {
    res.status(HttpStatus.OK).type('text/xml').send('<Response></Response>');

    void this.twilioWebhookService
      .handleInbound(flattenTwilioBody(payload))
      .catch((error) => {
        this.logger.error(
          `Unhandled error in Twilio webhook processing: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      });
  }
}

function flattenTwilioBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') out[key] = value;
    else if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}
