import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import type { AppConfig } from '../../config/configuration';

/**
 * Typed Stripe client wrapper.
 *
 * Responsibilities:
 *   - Lazily instantiate one `Stripe` SDK with the pinned API version.
 *   - Expose two narrow operations used by Phase 5: creating a hosted
 *     Checkout Session and verifying an inbound webhook signature.
 *   - Translate Stripe SDK errors into NestJS exceptions without leaking
 *     the secret or the raw SDK stack trace to callers.
 *
 * We intentionally do NOT expose the raw client — callers should never
 * reach outside this service; extend it instead. This keeps the surface
 * area testable via dependency injection in the validation harness.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly client: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    const stripeConfig = config.getOrThrow<AppConfig['stripe']>('stripe');
    if (!stripeConfig.secretKey) {
      throw new Error(
        'StripeService constructed without STRIPE_SECRET_KEY. ' +
          'assertRequiredConfig() should have caught this — refusing to run.',
      );
    }
    this.webhookSecret = stripeConfig.webhookSecret;

    this.client = new Stripe(stripeConfig.secretKey, {
      // Intentionally omit `apiVersion` so the SDK pins to its shipped
      // default — keeps us in sync with the generated types (upgrading
      // the SDK upgrades both). This is the recommended pattern per the
      // Stripe README for Node.
      typescript: true,
      // Human-readable label that appears in the Stripe dashboard under
      // "Source" for each session — makes audit trails easier without
      // leaking internal IDs to customers.
      appInfo: { name: 'simplex-backend', version: '0.0.1' },
    });
  }

  /**
   * Create a Stripe Checkout Session for a single-line order.
   *
   * We deliberately avoid Stripe's "Customer" abstraction in Phase 5 —
   * the customer identity lives in our `ClientContact` table; creating
   * a Stripe Customer too would double the source of truth and leak PII
   * into Stripe without explicit consent.
   */
  async createCheckoutSession(params: {
    amount: number;
    currency: string;
    productName: string;
    description: string | null;
    orderId: string;
    paymentId: string;
    successUrl: string;
    cancelUrl: string;
    customerEmail?: string | null;
  }): Promise<{ id: string; url: string; paymentIntentId: string | null }> {
    try {
      const session = await this.client.checkout.sessions.create({
        mode: 'payment',
        payment_method_types: ['card'],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        customer_email: params.customerEmail ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: params.currency.toLowerCase(),
              unit_amount: toStripeMinorUnits(params.amount),
              product_data: {
                name: params.productName,
                description: params.description ?? undefined,
              },
            },
          },
        ],
        // Stripe round-trips these on every webhook — we use them as our
        // idempotency hints when reconciling `checkout.session.completed`.
        metadata: {
          orderId: params.orderId,
          paymentId: params.paymentId,
        },
        // Forward the same keys onto the PaymentIntent so back-office
        // tooling can search by our paymentId even from the Stripe dashboard.
        payment_intent_data: {
          metadata: {
            orderId: params.orderId,
            paymentId: params.paymentId,
          },
        },
      });

      if (!session.url) {
        throw new InternalServerErrorException(
          'Stripe returned a session without a URL',
        );
      }

      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      return {
        id: session.id,
        url: session.url,
        paymentIntentId,
      };
    } catch (error) {
      this.logger.error(
        `Stripe checkout session creation failed: ${describeStripeError(error)}`,
      );
      if (error instanceof Stripe.errors.StripeError) {
        throw new InternalServerErrorException(
          `Stripe error: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * Verify a webhook signature against the raw request body. Returns the
   * constructed event on success, or throws if the signature is invalid
   * / stale. We intentionally never log `signature` or `rawBody`.
   */
  constructEvent(rawBody: Buffer, signatureHeader: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error(
        'STRIPE_WEBHOOK_SECRET is not configured — cannot verify webhook.',
      );
    }
    return this.client.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.webhookSecret,
    );
  }
}

/**
 * Stripe expects integer minor units (cents for USD). Round HALF_UP so
 * a 0.005 edge always lands on the higher cent; we never want to
 * silently under-charge.
 */
function toStripeMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

function describeStripeError(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return `${error.type}: ${error.message} (code=${error.code ?? 'n/a'})`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown stripe error';
}
