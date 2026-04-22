import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';

const SIGNATURE_HEADER = 'stripe-signature';

/**
 * Verifies the `Stripe-Signature` header against the raw body. Relies on
 * `{ rawBody: true }` at NestFactory level (already enabled for the Meta
 * webhook).
 *
 * Never echoes signatures, secrets, or rawBody content in logs. Any
 * mismatch → 401.
 */
@Injectable()
export class StripeSignatureGuard implements CanActivate {
  private readonly logger = new Logger(StripeSignatureGuard.name);

  constructor(private readonly stripe: StripeService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const headerRaw = req.headers[SIGNATURE_HEADER];
    const header = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

    if (!header || typeof header !== 'string') {
      this.logger.warn('Missing Stripe-Signature header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      this.logger.error(
        'Raw body unavailable — bootstrap must pass { rawBody: true } to NestFactory.create',
      );
      throw new UnauthorizedException('Cannot verify webhook signature');
    }

    try {
      const event = this.stripe.constructEvent(raw, header);
      // Stash the verified event on the request so the controller does
      // not re-verify nor re-parse.
      (req as RawBodyRequest<Request> & { stripeEvent?: Stripe.Event }).stripeEvent = event;
      return true;
    } catch (error) {
      this.logger.warn(
        `Stripe webhook signature verification failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}
