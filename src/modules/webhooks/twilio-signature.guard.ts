import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { TwilioConfig } from '../../config/configuration';
import { validateTwilioSignature } from './twilio-signature.util';

const SIGNATURE_HEADER = 'x-twilio-signature';

@Injectable()
export class TwilioSignatureGuard implements CanActivate {
  private readonly logger = new Logger(TwilioSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const twilio = this.config.getOrThrow<TwilioConfig>('twilio');

    if (twilio.webhookSkipSignature) {
      this.logger.warn(
        'Twilio webhook signature skipped — TWILIO_WEBHOOK_SKIP_SIGNATURE=true',
      );
      return true;
    }

    if (!twilio.authToken) {
      this.logger.error('TWILIO_AUTH_TOKEN missing — rejecting webhook');
      throw new UnauthorizedException('Twilio webhook signature not configured');
    }

    if (!twilio.webhookBaseUrl) {
      this.logger.error(
        'TWILIO_WEBHOOK_BASE_URL missing — rejecting webhook (required for signature validation)',
      );
      throw new UnauthorizedException('Twilio webhook URL not configured');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const headerRaw = req.headers[SIGNATURE_HEADER];
    const signature = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;
    if (!signature || typeof signature !== 'string') {
      this.logger.warn('Missing X-Twilio-Signature header');
      throw new UnauthorizedException('Missing Twilio webhook signature');
    }

    const params = flattenBody(req.body);
    const url = `${twilio.webhookBaseUrl}${req.originalUrl}`;

    if (!validateTwilioSignature(twilio.authToken, signature, url, params)) {
      this.logger.warn(`Invalid Twilio signature for ${req.originalUrl}`);
      throw new UnauthorizedException('Invalid Twilio webhook signature');
    }

    return true;
  }
}

function flattenBody(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === 'string') out[key] = value;
    else if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}
