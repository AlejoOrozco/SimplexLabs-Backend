import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { MetaConfig } from '../../config/configuration';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';

/**
 * Verifies the `X-Hub-Signature-256` header on inbound Meta webhooks. The
 * HMAC is computed over the raw request body — NestJS must be bootstrapped
 * with `{ rawBody: true }` so `req.rawBody` is populated.
 *
 * On any mismatch, malformed signature, or missing body, the request is
 * rejected with 401. The guard is deliberately conservative: it never
 * echoes the expected or provided signature in error messages.
 */
@Injectable()
export class MetaSignatureGuard implements CanActivate {
  private readonly logger = new Logger(MetaSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.config.getOrThrow<MetaConfig>('meta');
    if (!meta.appSecret) {
      this.logger.error(
        'META_APP_SECRET missing — rejecting webhook. Refuse to run without signature check.',
      );
      throw new UnauthorizedException('Webhook signature not configured');
    }

    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const headerRaw = req.headers[SIGNATURE_HEADER];
    const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

    if (!header || typeof header !== 'string') {
      this.logger.warn('Missing X-Hub-Signature-256 header on Meta webhook');
      throw new UnauthorizedException('Missing webhook signature');
    }

    if (!header.startsWith(SIGNATURE_PREFIX)) {
      this.logger.warn('Malformed X-Hub-Signature-256 header');
      throw new UnauthorizedException('Malformed webhook signature');
    }

    const providedHex = header.slice(SIGNATURE_PREFIX.length);
    if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
      this.logger.warn('Non-hex X-Hub-Signature-256 payload');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      this.logger.error(
        'Raw body unavailable — bootstrap must pass { rawBody: true } to NestFactory.create',
      );
      throw new UnauthorizedException('Cannot verify webhook signature');
    }

    const expectedHex = createHmac('sha256', meta.appSecret)
      .update(raw)
      .digest('hex');

    const provided = Buffer.from(providedHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      this.logger.warn('X-Hub-Signature-256 verification failed');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
