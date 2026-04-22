import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationLifecycleStatus,
  NotificationType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import type Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationLifecycleService } from '../conversations/conversation-lifecycle.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import type { AppConfig } from '../../config/configuration';
import { WebhookDedupeService } from '../../common/reliability/webhook-dedupe.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { ReviewWirePaymentDto } from './dto/review-wire-payment.dto';
import { AttachWireScreenshotDto } from './dto/attach-wire-screenshot.dto';
import {
  paymentInclude,
  toPaymentResponse,
  type PaymentWithRelations,
} from './payment.mapper';
import { PaymentResponseDto } from './dto/payment-response.dto';
import {
  INITIAL_STATUS_FOR_METHOD,
  assertTransition,
  canTransition,
  isTerminal,
} from './state/payment-state';
import { StripeService } from './stripe.service';

interface TransitionParams {
  paymentId: string;
  from: PaymentStatus;
  to: PaymentStatus;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
}

/**
 * Central payment orchestration. Owns:
 *   - INITIATE (Stripe checkout session or wire transfer AWAITING row)
 *   - TRANSITION (state-machine-enforced status changes + event log)
 *   - WIRE REVIEW (approve / reject)
 *   - WEBHOOK reconciliation (called by StripeWebhookController)
 *
 * Cross-cutting invariants:
 *   - Every status change writes a `PaymentEvent` in the same transaction.
 *   - Idempotency is enforced on Stripe event ids AND on conflicting
 *     forward transitions (CANCELLED cannot be re-confirmed).
 *   - Lifecycle transitions are dispatched to `ConversationLifecycleService`
 *     so the dashboard reflects order/payment progress without duplication.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeService,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly dedupe: WebhookDedupeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findAll(requester: AuthenticatedUser): Promise<PaymentResponseDto[]> {
    const rows = await this.prisma.payment.findMany({
      where: scopedCompanyWhere(requester),
      include: paymentInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPaymentResponse);
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    const row = await this.loadOrThrow(id, requester);
    return toPaymentResponse(row);
  }

  // ---------------------------------------------------------------------------
  // Initiation
  // ---------------------------------------------------------------------------

  /**
   * Initiate a payment for an existing order. Method is validated against
   * the company's `CompanySettings` toggles. Stripe creates a Checkout
   * Session; Wire creates a placeholder row in AWAITING_SCREENSHOT.
   */
  async initiate(
    dto: InitiatePaymentDto,
    requester: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    if (!requester.companyId && requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only tenant users can initiate payments');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        product: { select: { name: true, description: true } },
        contact: { select: { id: true, email: true, phone: true } },
      },
    });
    if (!order) throw new NotFoundException(`Order ${dto.orderId} not found`);
    assertTenantAccess(order.companyId, requester);

    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException(
        `Order is in terminal status ${order.status}; cannot initiate a payment.`,
      );
    }

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId: order.companyId },
      select: {
        stripeEnabled: true,
        wireTransferEnabled: true,
        wireTransferInstructions: true,
      },
    });
    if (!settings) {
      throw new BadRequestException(
        'CompanySettings missing — cannot determine enabled payment methods.',
      );
    }

    if (dto.method === PaymentMethod.STRIPE && !settings.stripeEnabled) {
      throw new BadRequestException('Stripe is not enabled for this company.');
    }
    if (
      dto.method === PaymentMethod.WIRE_TRANSFER &&
      !settings.wireTransferEnabled
    ) {
      throw new BadRequestException(
        'Wire transfer is not enabled for this company.',
      );
    }

    const amount =
      dto.amount !== undefined ? dto.amount : Number(order.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Payment amount must be > 0.');
    }
    const currency = (dto.currency ?? 'USD').toUpperCase();

    // Locate the conversation linked to this order (via the customer's
    // most-recent open thread) so the frontend / executor can surface
    // payment state without a separate join.
    const conversationId = await this.resolveConversationId(
      order.companyId,
      order.contact.id,
    );

    const initial = INITIAL_STATUS_FOR_METHOD[dto.method];

    if (dto.method === PaymentMethod.STRIPE) {
      return this.initiateStripe({
        companyId: order.companyId,
        orderId: order.id,
        contactId: order.contact.id,
        conversationId,
        contactEmail: order.contact.email,
        productName: order.product.name,
        productDescription: order.product.description,
        amount,
        currency,
        initialStatus: initial,
      });
    }

    return this.initiateWire({
      companyId: order.companyId,
      orderId: order.id,
      contactId: order.contact.id,
      conversationId,
      amount,
      currency,
      initialStatus: initial,
      wireInstructions:
        settings.wireTransferInstructions ??
        'Please contact us for wire transfer instructions.',
    });
  }

  // ---------------------------------------------------------------------------
  // Wire: screenshot upload (AWAITING_SCREENSHOT → PENDING_REVIEW)
  // ---------------------------------------------------------------------------

  async attachWireScreenshot(
    id: string,
    dto: AttachWireScreenshotDto,
    requester: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    const existing = await this.loadOrThrow(id, requester);
    if (existing.method !== PaymentMethod.WIRE_TRANSFER) {
      throw new BadRequestException(
        'Only wire transfer payments accept a screenshot.',
      );
    }
    if (existing.status !== PaymentStatus.AWAITING_SCREENSHOT) {
      throw new ConflictException(
        `Payment is in ${existing.status}; cannot attach a screenshot.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: {
          wireScreenshotUrl: dto.screenshotUrl,
        },
      });
      await this.transitionWithinTx(tx, {
        paymentId: id,
        from: PaymentStatus.AWAITING_SCREENSHOT,
        to: PaymentStatus.PENDING_REVIEW,
        reason: 'wire_screenshot_uploaded',
        metadata: { screenshotUrl: dto.screenshotUrl },
      });
    });

    await this.lifecycle.transition(
      existing.conversationId,
      ConversationLifecycleStatus.PAYMENT_PENDING_REVIEW,
    );

    try {
      await this.notifications.create({
        companyId: existing.companyId,
        type: NotificationType.PAYMENT_SCREENSHOT_RECEIVED,
        title: 'Wire transfer screenshot received',
        body: 'A customer uploaded a wire transfer screenshot. Review and approve or reject.',
        conversationId: existing.conversationId,
        payload: {
          paymentId: existing.id,
          orderId: existing.orderId,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Wire screenshot notification create failed payment=${existing.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.reload(id);
  }

  // ---------------------------------------------------------------------------
  // Wire: review decision (approve / reject)
  // ---------------------------------------------------------------------------

  async reviewWire(
    id: string,
    dto: ReviewWirePaymentDto,
    requester: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    const existing = await this.loadOrThrow(id, requester);
    if (existing.method !== PaymentMethod.WIRE_TRANSFER) {
      throw new BadRequestException(
        'Review is only applicable to wire transfer payments.',
      );
    }
    if (existing.status !== PaymentStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `Payment must be in PENDING_REVIEW to review; currently ${existing.status}.`,
      );
    }

    const approve = dto.decision === 'APPROVE';
    if (!approve && !dto.reason) {
      throw new BadRequestException('Rejection reason is required.');
    }

    const nextStatus = approve ? PaymentStatus.CONFIRMED : PaymentStatus.FAILED;

    await this.prisma.$transaction(async (tx) => {
      await this.transitionWithinTx(tx, {
        paymentId: id,
        from: PaymentStatus.PENDING_REVIEW,
        to: nextStatus,
        reason: approve
          ? (dto.reason ?? 'wire_approved')
          : (dto.reason ?? 'wire_rejected'),
        metadata: { reviewerId: requester.id },
      });

      if (approve && existing.orderId) {
        await this.confirmOrderIfPossible(tx, existing.orderId, requester.id);
      }
    });

    await this.dispatchPaymentLifecycle(
      existing.conversationId,
      nextStatus,
    );

    return this.reload(id);
  }

  // ---------------------------------------------------------------------------
  // Stripe webhook reconciliation — called by the webhook controller only
  // ---------------------------------------------------------------------------

  /**
   * Apply a verified Stripe event to our Payment row.
   *
   * Idempotency strategy:
   *   1. We persist a PaymentEvent keyed by `metadata.stripeEventId`.
   *      `createMany(skipDuplicates: false)` cannot key on JSON columns,
   *      so we check-before-insert inside the transaction using a
   *      bounded `findFirst`. This costs one indexed lookup per delivery
   *      but guarantees no duplicate transitions.
   *   2. If the target transition is not allowed from the current state
   *      (e.g. a late `succeeded` arrives after we already CANCELLED),
   *      we log and no-op — Stripe webhooks must always 200, or they
   *      retry forever.
   *
   * Returns a short string describing the outcome (for the webhook log).
   */
  async applyStripeEvent(event: Stripe.Event): Promise<string> {
    // Phase 8 idempotency choke-point. We CLAIM the event on the
    // `webhook_events` table BEFORE any domain-side effect. A concurrent
    // redelivery loses the (provider, providerEventId) unique-index
    // race and short-circuits with `duplicate_event`. The in-row
    // `metadata.stripeEventId` audit inside PaymentEvent stays as a
    // defense-in-depth check but is no longer the only guarantee.
    const claim = await this.dedupe.claim({
      provider: 'stripe',
      providerEventId: event.id,
    });
    if (!claim.claimed) {
      this.logger.log(
        `stripe_webhook.duplicate event=${event.id} type=${event.type}`,
      );
      return 'duplicate_event';
    }

    try {
      const outcome = await this.dispatchStripeEvent(event);
      await this.dedupe.markProcessed(claim.id, outcome);
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      await this.dedupe.markFailed(claim.id, message);
      throw error;
    }
  }

  private async dispatchStripeEvent(event: Stripe.Event): Promise<string> {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return this.handleStripeSuccess(event);

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
      case 'payment_intent.payment_failed':
        return this.handleStripeFailure(event);

      default:
        return `ignored_event_type:${event.type}`;
    }
  }

  // ---------------------------------------------------------------------------
  // INTERNAL: initiation paths
  // ---------------------------------------------------------------------------

  private async initiateStripe(args: {
    companyId: string;
    orderId: string;
    contactId: string;
    conversationId: string | null;
    contactEmail: string | null;
    productName: string;
    productDescription: string | null;
    amount: number;
    currency: string;
    initialStatus: PaymentStatus;
  }): Promise<PaymentResponseDto> {
    const stripeConfig = this.config.getOrThrow<AppConfig['stripe']>('stripe');
    if (!stripeConfig.successUrl || !stripeConfig.cancelUrl) {
      throw new BadRequestException(
        'Stripe success/cancel URLs are not configured.',
      );
    }

    // Persist the Payment row FIRST (without stripe ids) so we have a
    // stable paymentId to round-trip through Stripe metadata. Then call
    // the SDK and PATCH the stripe identifiers on success. If the SDK
    // throws, we mark the payment FAILED and propagate the error.
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          companyId: args.companyId,
          contactId: args.contactId,
          orderId: args.orderId,
          conversationId: args.conversationId,
          method: PaymentMethod.STRIPE,
          status: args.initialStatus,
          amount: new Prisma.Decimal(args.amount),
          currency: args.currency,
        },
        select: { id: true },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: created.id,
          prevStatus: null,
          newStatus: args.initialStatus,
          reason: 'stripe_session_initiating',
        },
      });
      return created;
    });

    let session: {
      id: string;
      url: string;
      paymentIntentId: string | null;
    };
    try {
      session = await this.stripe.createCheckoutSession({
        amount: args.amount,
        currency: args.currency,
        productName: args.productName,
        description: args.productDescription,
        orderId: args.orderId,
        paymentId: payment.id,
        successUrl: stripeConfig.successUrl,
        cancelUrl: stripeConfig.cancelUrl,
        customerEmail: args.contactEmail,
      });
    } catch (error) {
      // Session creation failed — mark the payment FAILED with details
      // so the UI and audit trail reflect reality.
      await this.prisma.$transaction(async (tx) => {
        await this.transitionWithinTx(tx, {
          paymentId: payment.id,
          from: args.initialStatus,
          to: PaymentStatus.FAILED,
          reason: 'stripe_session_create_failed',
          metadata: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
      throw error;
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        stripePaymentIntentId: session.paymentIntentId,
        notes: `stripe_session:${session.id}`,
      },
    });
    await this.prisma.paymentEvent.create({
      data: {
        paymentId: payment.id,
        prevStatus: args.initialStatus,
        newStatus: args.initialStatus, // no status change; audit-only
        reason: 'stripe_session_created',
        metadata: { sessionId: session.id, hasUrl: true },
      },
    });

    await this.lifecycle.transition(
      args.conversationId,
      ConversationLifecycleStatus.PAYMENT_INITIATED,
    );

    const full = await this.reload(payment.id);
    return { ...full, checkoutUrl: session.url };
  }

  private async initiateWire(args: {
    companyId: string;
    orderId: string;
    contactId: string;
    conversationId: string | null;
    amount: number;
    currency: string;
    initialStatus: PaymentStatus;
    wireInstructions: string;
  }): Promise<PaymentResponseDto> {
    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          companyId: args.companyId,
          contactId: args.contactId,
          orderId: args.orderId,
          conversationId: args.conversationId,
          method: PaymentMethod.WIRE_TRANSFER,
          status: args.initialStatus,
          amount: new Prisma.Decimal(args.amount),
          currency: args.currency,
        },
        select: { id: true },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: created.id,
          prevStatus: null,
          newStatus: args.initialStatus,
          reason: 'wire_initiated',
        },
      });
      return created;
    });

    await this.lifecycle.transition(
      args.conversationId,
      ConversationLifecycleStatus.PAYMENT_INITIATED,
    );

    const full = await this.reload(payment.id);
    return { ...full, wireInstructions: args.wireInstructions };
  }

  // ---------------------------------------------------------------------------
  // INTERNAL: Stripe webhook handlers
  // ---------------------------------------------------------------------------

  private async handleStripeSuccess(event: Stripe.Event): Promise<string> {
    const extracted = extractStripeIds(event);
    if (!extracted.paymentId) {
      this.logger.warn(
        `Stripe ${event.type} ${event.id} missing metadata.paymentId; cannot reconcile.`,
      );
      return 'no_payment_metadata';
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: extracted.paymentId },
      select: {
        id: true,
        status: true,
        orderId: true,
        conversationId: true,
      },
    });
    if (!payment) {
      this.logger.warn(
        `Stripe ${event.type} ${event.id} references unknown paymentId=${extracted.paymentId}.`,
      );
      return 'payment_not_found';
    }

    if (await this.hasProcessedStripeEvent(payment.id, event.id)) {
      return 'duplicate_event';
    }

    if (payment.status === PaymentStatus.CONFIRMED) {
      // Already confirmed — write an audit-only event and return. This
      // is the steady-state path when Stripe retries after our 200.
      await this.prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          prevStatus: payment.status,
          newStatus: payment.status,
          reason: 'duplicate_stripe_success',
          metadata: { stripeEventId: event.id, stripeEventType: event.type },
        },
      });
      return 'already_confirmed';
    }

    if (!canTransition(payment.status, PaymentStatus.CONFIRMED)) {
      this.logger.warn(
        `Stripe success for payment=${payment.id} ignored: current status ${payment.status} cannot move to CONFIRMED.`,
      );
      await this.prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          prevStatus: payment.status,
          newStatus: payment.status,
          reason: 'stripe_success_ignored_invalid_state',
          metadata: { stripeEventId: event.id, current: payment.status },
        },
      });
      return 'invalid_transition_noop';
    }

    await this.prisma.$transaction(async (tx) => {
      await this.transitionWithinTx(tx, {
        paymentId: payment.id,
        from: payment.status,
        to: PaymentStatus.CONFIRMED,
        reason: 'stripe_webhook_success',
        metadata: {
          stripeEventId: event.id,
          stripeEventType: event.type,
          paymentIntentId: extracted.paymentIntentId,
          chargeId: extracted.chargeId,
        },
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          stripePaymentIntentId: extracted.paymentIntentId,
          stripeChargeId: extracted.chargeId,
        },
      });
      if (payment.orderId) {
        await this.confirmOrderIfPossible(tx, payment.orderId, null);
      }
    });

    await this.lifecycle.transition(
      payment.conversationId,
      ConversationLifecycleStatus.PAYMENT_CONFIRMED,
    );

    return 'confirmed';
  }

  private async handleStripeFailure(event: Stripe.Event): Promise<string> {
    const extracted = extractStripeIds(event);
    if (!extracted.paymentId) {
      this.logger.warn(
        `Stripe ${event.type} ${event.id} missing metadata.paymentId; cannot reconcile.`,
      );
      return 'no_payment_metadata';
    }

    const payment = await this.prisma.payment.findUnique({
      where: { id: extracted.paymentId },
      select: { id: true, status: true, conversationId: true },
    });
    if (!payment) return 'payment_not_found';

    if (await this.hasProcessedStripeEvent(payment.id, event.id)) {
      return 'duplicate_event';
    }

    if (isTerminal(payment.status)) {
      await this.prisma.paymentEvent.create({
        data: {
          paymentId: payment.id,
          prevStatus: payment.status,
          newStatus: payment.status,
          reason: 'stripe_failure_ignored_terminal',
          metadata: { stripeEventId: event.id, stripeEventType: event.type },
        },
      });
      return 'already_terminal';
    }

    if (!canTransition(payment.status, PaymentStatus.FAILED)) {
      this.logger.warn(
        `Stripe failure for payment=${payment.id} ignored: current status ${payment.status} cannot move to FAILED.`,
      );
      return 'invalid_transition_noop';
    }

    await this.prisma.$transaction(async (tx) => {
      await this.transitionWithinTx(tx, {
        paymentId: payment.id,
        from: payment.status,
        to: PaymentStatus.FAILED,
        reason: 'stripe_webhook_failure',
        metadata: {
          stripeEventId: event.id,
          stripeEventType: event.type,
        },
      });
    });

    // No lifecycle success; UI surfaces failure via payment detail read.
    return 'failed';
  }

  // ---------------------------------------------------------------------------
  // INTERNAL: helpers (state, persistence, loading)
  // ---------------------------------------------------------------------------

  /**
   * The single choke-point for status changes. Enforces the state machine
   * and writes the `PaymentEvent` inside the caller's transaction so the
   * status + event are atomic.
   */
  private async transitionWithinTx(
    tx: Prisma.TransactionClient,
    params: TransitionParams,
  ): Promise<void> {
    assertTransition(params.from, params.to);

    // Compare-and-swap on the current status prevents double-application
    // if two concurrent flows attempt the same transition (e.g. webhook +
    // manual reconcile).
    const updated = await tx.payment.updateMany({
      where: { id: params.paymentId, status: params.from },
      data: { status: params.to, updatedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        `Payment ${params.paymentId} is no longer in ${params.from}; refusing ${params.to}.`,
      );
    }

    await tx.paymentEvent.create({
      data: {
        paymentId: params.paymentId,
        prevStatus: params.from,
        newStatus: params.to,
        reason: params.reason ?? null,
        metadata: params.metadata ?? undefined,
      },
    });
  }

  /**
   * Idempotency check — looks for a prior PaymentEvent tagged with the
   * given Stripe event id. Single indexed read; we accept the JSON-path
   * filter cost in exchange for not needing a dedicated table in Phase 5.
   */
  private async hasProcessedStripeEvent(
    paymentId: string,
    stripeEventId: string,
  ): Promise<boolean> {
    const match = await this.prisma.paymentEvent.findFirst({
      where: {
        paymentId,
        metadata: { path: ['stripeEventId'], equals: stripeEventId },
      },
      select: { id: true },
    });
    return match !== null;
  }

  private async confirmOrderIfPossible(
    tx: Prisma.TransactionClient,
    orderId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, companyId: true },
    });
    if (!order) return;
    if (order.status !== OrderStatus.PENDING) return; // only auto-advance from PENDING

    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED },
    });

    if (actorUserId) {
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          changedById: actorUserId,
          prevStatus: OrderStatus.PENDING,
          newStatus: OrderStatus.CONFIRMED,
          reason: 'payment_confirmed',
        },
      });
      return;
    }

    // Webhook-driven (no human actor). Fall back to the company owner so
    // audit trail remains complete without NULL columns.
    const owner = await tx.user.findFirst({
      where: { companyId: order.companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (owner) {
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          changedById: owner.id,
          prevStatus: OrderStatus.PENDING,
          newStatus: OrderStatus.CONFIRMED,
          reason: 'stripe_webhook_auto_confirm',
        },
      });
    }
  }

  private async dispatchPaymentLifecycle(
    conversationId: string | null,
    next: PaymentStatus,
  ): Promise<void> {
    switch (next) {
      case PaymentStatus.CONFIRMED:
        await this.lifecycle.transition(
          conversationId,
          ConversationLifecycleStatus.PAYMENT_CONFIRMED,
        );
        break;
      case PaymentStatus.FAILED:
      case PaymentStatus.CANCELLED:
        // No dedicated enum for failure yet — keep AGENT_REPLIED_WAITING
        // so the dashboard returns control to the agent path.
        await this.lifecycle.transition(
          conversationId,
          ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
        );
        break;
      default:
        break;
    }
  }

  /**
   * Return the active OPEN conversation for a contact on any channel so
   * `Payment.conversationId` can be set. Best-effort — wire-only flows
   * initiated by an admin may have no live conversation and that's fine.
   */
  private async resolveConversationId(
    companyId: string,
    contactId: string,
  ): Promise<string | null> {
    const convo = await this.prisma.conversation.findFirst({
      where: { companyId, contactId, status: 'OPEN' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    return convo?.id ?? null;
  }

  private async loadOrThrow(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<PaymentWithRelations> {
    const row = await this.prisma.payment.findUnique({
      where: { id },
      include: paymentInclude,
    });
    if (!row) throw new NotFoundException(`Payment ${id} not found`);
    assertTenantAccess(row.companyId, requester);
    return row;
  }

  private async reload(id: string): Promise<PaymentResponseDto> {
    const row = await this.prisma.payment.findUniqueOrThrow({
      where: { id },
      include: paymentInclude,
    });
    return toPaymentResponse(row);
  }
}

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function extractStripeIds(event: Stripe.Event): {
  paymentId: string | null;
  orderId: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
} {
  const obj = event.data.object as {
    id?: string;
    payment_intent?: string | { id: string } | null;
    latest_charge?: string | { id: string } | null;
    metadata?: Record<string, string | undefined>;
  };

  const resolveId = (
    value: string | { id: string } | null | undefined,
  ): string | null => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    return value.id ?? null;
  };

  return {
    paymentId: obj.metadata?.paymentId ?? null,
    orderId: obj.metadata?.orderId ?? null,
    paymentIntentId: resolveId(obj.payment_intent),
    chargeId: resolveId(obj.latest_charge),
  };
}
