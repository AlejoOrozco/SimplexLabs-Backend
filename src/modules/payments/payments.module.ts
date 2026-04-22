import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from './stripe.service';
import { StripeSignatureGuard } from './stripe-signature.guard';

/**
 * PaymentsModule owns:
 *   - Tenant-scoped REST for payment list/detail/initiate/review
 *   - Stripe webhook endpoint (raw body, verified, idempotent)
 *   - State-machine-enforced Payment lifecycle + PaymentEvent audit log
 *
 * Depends on `ConversationsModule` for `ConversationLifecycleService`
 * so we can transition conversation lifecycle in lockstep with payment
 * state changes.
 */
@Module({
  imports: [ConversationsModule, NotificationsModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [PaymentsService, StripeService, StripeSignatureGuard],
  exports: [PaymentsService],
})
export class PaymentsModule {}
