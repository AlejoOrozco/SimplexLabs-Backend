import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type Stripe from 'stripe';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { PaymentsService } from './payments.service';
import { StripeSignatureGuard } from './stripe-signature.guard';

/**
 * Dedicated raw-body endpoint for Stripe webhooks.
 *
 * Mounted at `/webhooks/stripe` (so it sits alongside `/webhooks/meta`
 * under the same prefix). The `StripeSignatureGuard` verifies the
 * payload, parses the event once, and stashes it on the request — this
 * controller only dispatches to the service and responds 200.
 *
 * Stripe retries any non-2xx for up to 72 hours; we ALWAYS return 200
 * on any processing outcome. Actual success / no-op / failure state is
 * captured on the Payment + PaymentEvent audit log, not the HTTP status.
 */
@ApiTags('Webhooks')
@Controller('webhooks/stripe')
@SkipThrottle()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @UseGuards(StripeSignatureGuard)
  @RawResponse()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive Stripe webhook events (raw body + signature).' })
  @ApiExcludeEndpoint()
  async receive(
    @Req() req: RawBodyRequest<Request> & { stripeEvent?: Stripe.Event },
    @Res() res: Response,
  ): Promise<void> {
    const event = req.stripeEvent;
    if (!event) {
      // Should never happen — guard rejects on any failure and sets the
      // event. Guard the path anyway so a misconfiguration is loud.
      this.logger.error('Stripe webhook reached controller without verified event');
      res.status(HttpStatus.OK).send();
      return;
    }

    // ACK optimistically, then apply. Stripe's delivery SLA demands a
    // quick 200. We swallow any processing error into the log: the
    // PaymentEvent table is the source of truth.
    res.status(HttpStatus.OK).send();
    try {
      const outcome = await this.payments.applyStripeEvent(event);
      this.logger.log(
        `Stripe webhook processed event=${event.id} type=${event.type} outcome=${outcome}`,
      );
    } catch (error) {
      this.logger.error(
        `Stripe webhook processing failed event=${event.id} type=${event.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
