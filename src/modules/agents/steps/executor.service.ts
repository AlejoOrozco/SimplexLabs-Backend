import { Injectable, Logger } from '@nestjs/common';
import {
  AppointmentType,
  ConversationLifecycleStatus,
  NotificationType,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AvailabilityService } from '../../scheduling/availability.service';
import { ConversationLifecycleService } from '../../conversations/conversation-lifecycle.service';
import { PaymentsService } from '../../payments/payments.service';
import { NotificationsService } from '../../notifications/notifications.service';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import type {
  DeciderOutput,
  ExecutorAppointmentAlternative,
  ExecutorAppointmentResult,
  ExecutorOrderResult,
  ExecutorOutput,
  ExecutorPaymentResult,
  PipelineContext,
  RetrievedKbEntry,
  RetrievedProduct,
  RetrievedStaff,
  RetrieverOutput,
} from '../pipeline/pipeline-types';

export interface ExecutorStepInput {
  context: PipelineContext;
  decision: DeciderOutput;
  retrieval: RetrieverOutput;
}

export interface ExecutorStepResult {
  input: {
    decisionAction: DeciderOutput['action'];
    requestedKbIds: string[];
    requestedProductIds: string[];
    requestedStaffIds: string[];
    requestedAppointment?: NonNullable<DeciderOutput['payload']['appointment']>;
  };
  output: ExecutorOutput;
}

/** Default forward-looking window used when the decider gave no ISO hint. */
const FALLBACK_SEARCH_DAYS = 7;
/** Upper bound for alternatives surfaced back to the Responder. */
const MAX_ALTERNATIVES = 3;

/**
 * Phase 4 Executor — now has real side effects for SUGGEST_APPOINTMENT:
 *
 *   REPLY / REPLY_WITH_KB / SUGGEST_PRODUCT / NONE
 *     → classified as `executed` (no DB side effect; Responder emits text).
 *
 *   SUGGEST_APPOINTMENT
 *     1. Resolve the contact (organizer / customer) from the conversation.
 *     2. Resolve a preferred staff member from decider hints (id > name).
 *     3. Compute availability for the requested ISO (if any) OR the next
 *        7 days; pick first valid slot.
 *     4. Re-check the slot atomically right before insert (defends against
 *        stale availability in concurrent bookings) and create a PENDING
 *        Appointment linked to the conversation.
 *     5. Move conversation lifecycle → APPOINTMENT_PENDING.
 *     6. If no slot matches, emit up to 3 alternatives and mark `deferred`.
 *
 *   ESCALATE
 *     → deferred (notification fan-out is Phase 5+).
 *
 * The Executor NEVER throws; failures are captured on the output so the
 * Responder can always speak to the customer.
 */
@Injectable()
export class ExecutorService {
  private readonly logger = new Logger(ExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(input: ExecutorStepInput): Promise<ExecutorStepResult> {
    const { context, decision, retrieval } = input;

    const kbById = new Map(retrieval.knowledgeBase.map((k) => [k.id, k]));
    const productById = new Map(retrieval.products.map((p) => [p.id, p]));
    const staffById = new Map(retrieval.staff.map((s) => [s.id, s]));

    const resolvedKb: RetrievedKbEntry[] = decision.payload.kbIds
      .map((id) => kbById.get(id))
      .filter((k): k is RetrievedKbEntry => k !== undefined);
    const resolvedProducts: RetrievedProduct[] = decision.payload.productIds
      .map((id) => productById.get(id))
      .filter((p): p is RetrievedProduct => p !== undefined);
    const resolvedStaff: RetrievedStaff[] = decision.payload.staffIds
      .map((id) => staffById.get(id))
      .filter((s): s is RetrievedStaff => s !== undefined);

    const baseInput = {
      decisionAction: decision.action,
      requestedKbIds: decision.payload.kbIds,
      requestedProductIds: decision.payload.productIds,
      requestedStaffIds: decision.payload.staffIds,
      requestedAppointment: decision.payload.appointment,
    };

    if (decision.action === 'SUGGEST_APPOINTMENT') {
      const appointment = await this.tryBookAppointment(
        context,
        decision,
        resolvedStaff,
      );
      const executed = appointment.created;
      if (executed && appointment.appointmentId) {
        await this.safeNotify({
          companyId: context.companyId,
          type: NotificationType.APPOINTMENT_REQUESTED,
          title: 'New appointment request',
          body: appointment.staffName
            ? `A customer requested an appointment with ${appointment.staffName} on ${appointment.scheduledAt}.`
            : `A customer requested an appointment on ${appointment.scheduledAt}.`,
          conversationId: context.conversationId,
          payload: {
            appointmentId: appointment.appointmentId,
            scheduledAt: appointment.scheduledAt,
            staffId: appointment.staffId,
          },
        });
      }
      return {
        input: baseInput,
        output: {
          action: decision.action,
          executed,
          deferred: !executed,
          deferredReason: executed ? null : appointment.reason,
          result: {
            resolvedKb,
            resolvedProducts,
            resolvedStaff,
            appointment,
          },
        },
      };
    }

    if (decision.action === 'PLACE_ORDER') {
      const order = await this.tryPlaceOrder(context, decision, resolvedProducts);
      return {
        input: baseInput,
        output: {
          action: decision.action,
          executed: order.created,
          deferred: !order.created,
          deferredReason: order.created ? null : order.reason,
          result: {
            resolvedKb,
            resolvedProducts,
            resolvedStaff,
            order,
          },
        },
      };
    }

    if (decision.action === 'REQUEST_PAYMENT') {
      const payment = await this.tryRequestPayment(context, decision);
      return {
        input: baseInput,
        output: {
          action: decision.action,
          executed: payment.initiated,
          deferred: !payment.initiated,
          deferredReason: payment.initiated ? null : payment.reason,
          result: {
            resolvedKb,
            resolvedProducts,
            resolvedStaff,
            payment,
          },
        },
      };
    }

    const { executed, deferred, deferredReason } = this.classifyNonAppointment(
      decision.action,
    );

    if (decision.action === 'ESCALATE') {
      await this.lifecycle.transition(
        context.conversationId,
        ConversationLifecycleStatus.NEEDS_ATTENTION,
      );
      const reasonText = (decision.reason ?? '').trim();
      await this.safeNotify({
        companyId: context.companyId,
        type: NotificationType.AGENT_NEEDS_ATTENTION,
        title: 'Agent needs human attention',
        body:
          reasonText.length > 0
            ? reasonText.slice(0, 280)
            : 'The agent flagged this conversation for a human review.',
        conversationId: context.conversationId,
        payload: {
          reason: reasonText.length > 0 ? reasonText : null,
          messageId: context.messageId,
        },
      });
    }

    return {
      input: baseInput,
      output: {
        action: decision.action,
        executed,
        deferred,
        deferredReason,
        result: {
          resolvedKb,
          resolvedProducts,
          resolvedStaff,
        },
      },
    };
  }

  /**
   * Never let a notification failure crash the pipeline step. We already
   * ship audit rows through NotificationsService itself; errors here
   * usually mean the DB or the realtime gateway is blipping and the
   * pipeline should continue to answer the customer.
   */
  private async safeNotify(params: {
    companyId: string;
    type: NotificationType;
    title: string;
    body: string;
    conversationId: string | null;
    payload: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.notifications.create({
        companyId: params.companyId,
        type: params.type,
        title: params.title,
        body: params.body,
        conversationId: params.conversationId,
        payload: params.payload,
      });
    } catch (error) {
      this.logger.warn(
        `Notification create failed type=${params.type} company=${params.companyId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private classifyNonAppointment(action: DeciderOutput['action']): {
    executed: boolean;
    deferred: boolean;
    deferredReason: string | null;
  } {
    switch (action) {
      case 'REPLY':
      case 'REPLY_WITH_KB':
      case 'SUGGEST_PRODUCT':
      case 'NONE':
        return { executed: true, deferred: false, deferredReason: null };
      case 'ESCALATE':
        return {
          executed: false,
          deferred: true,
          deferredReason:
            'Human handoff notification fan-out is deferred to Phase 5+.',
        };
      default:
        return {
          executed: false,
          deferred: true,
          deferredReason: `Unknown action: ${action}`,
        };
    }
  }

  private async tryBookAppointment(
    context: PipelineContext,
    decision: DeciderOutput,
    resolvedStaff: RetrievedStaff[],
  ): Promise<ExecutorAppointmentResult> {
    const hint = decision.payload.appointment;

    // Resolve conversation metadata (contactId + organizer candidate). The
    // organizer must be a real User row; we pick the contact's company owner
    // as the fallback organizer since Phase 4 agent-created appointments are
    // initiated by the system, not a human user.
    const convo = await this.prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: {
        contactId: true,
        contact: { select: { firstName: true, lastName: true } },
      },
    });
    if (!convo) {
      return this.noBookingResult(
        'Conversation not found; cannot create appointment.',
      );
    }

    const organizer = await this.resolveOrganizer(context.companyId);
    if (!organizer) {
      return this.noBookingResult(
        'No active owner user for company; cannot assign an organizer.',
      );
    }

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId: context.companyId },
      select: { defaultSlotDurationMinutes: true },
    });
    const duration =
      hint?.durationMinutes ??
      settings?.defaultSlotDurationMinutes ??
      30;

    const preferredStaffId = await this.resolvePreferredStaff(
      context.companyId,
      resolvedStaff,
      hint?.staffName,
    );

    const now = new Date();
    const searchFrom = this.resolveSearchFrom(hint?.requestedAtIso, now);
    const searchTo = new Date(
      searchFrom.getTime() + FALLBACK_SEARCH_DAYS * 24 * 60 * 60 * 1000,
    );

    const slots = await this.availability.compute({
      companyId: context.companyId,
      fromUtc: searchFrom,
      toUtc: searchTo,
      staffId: preferredStaffId ?? undefined,
      durationMinutes: duration,
    });

    if (slots.length === 0) {
      return this.noBookingResult(
        'No available slot found within the next 7 days.',
      );
    }

    // If the decider emitted an explicit ISO, only consider that exact
    // start; otherwise take the first available slot.
    const requestedStart = hint?.requestedAtIso
      ? new Date(hint.requestedAtIso)
      : null;

    const candidate =
      requestedStart !== null
        ? slots.find(
            (s) => s.startsAt.getTime() === requestedStart.getTime(),
          ) ?? null
        : slots[0];

    if (!candidate) {
      return {
        created: false,
        appointmentId: null,
        scheduledAt: null,
        durationMinutes: duration,
        staffId: null,
        staffName: null,
        alternatives: slots.slice(0, MAX_ALTERNATIVES).map(toAlternative),
        reason: 'Requested slot not available; offered alternatives.',
      };
    }

    // Final race-check + atomic create inside one tx.
    try {
      const appt = await this.prisma.$transaction(async (tx) => {
        const stillFree = await this.availability.isSlotAvailable({
          companyId: context.companyId,
          staffId: candidate.staffId,
          startsAt: candidate.startsAt,
          durationMinutes: duration,
        });
        if (!stillFree) {
          throw new StaleSlotError();
        }

        const contactName = [
          convo.contact?.firstName,
          convo.contact?.lastName,
        ]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .join(' ');
        const title =
          hint?.title?.trim() ||
          (contactName.length > 0
            ? `Appointment with ${contactName}`
            : 'Customer appointment');

        const created = await tx.appointment.create({
          data: {
            companyId: context.companyId,
            organizerId: organizer,
            contactId: convo.contactId,
            staffId: candidate.staffId,
            title,
            type: AppointmentType.CLIENT_WITH_CONTACT,
            status: 'PENDING',
            scheduledAt: candidate.startsAt,
            durationMinutes: duration,
          },
          select: { id: true },
        });

        await tx.conversation.update({
          where: { id: context.conversationId },
          data: {
            lifecycleStatus: ConversationLifecycleStatus.APPOINTMENT_PENDING,
            updatedAt: new Date(),
          },
        });

        return created;
      });

      return {
        created: true,
        appointmentId: appt.id,
        scheduledAt: candidate.startsAt.toISOString(),
        durationMinutes: duration,
        staffId: candidate.staffId,
        staffName: candidate.staffName,
        alternatives: [],
        reason: 'Appointment created in PENDING state, awaiting client review.',
      };
    } catch (error) {
      if (error instanceof StaleSlotError) {
        const remaining = await this.availability.compute({
          companyId: context.companyId,
          fromUtc: new Date(candidate.startsAt.getTime() + 60 * 1000),
          toUtc: searchTo,
          staffId: preferredStaffId ?? undefined,
          durationMinutes: duration,
        });
        return {
          created: false,
          appointmentId: null,
          scheduledAt: null,
          durationMinutes: duration,
          staffId: null,
          staffName: null,
          alternatives: remaining.slice(0, MAX_ALTERNATIVES).map(toAlternative),
          reason:
            'Slot was taken between availability check and booking; offered alternatives.',
        };
      }
      this.logger.error(
        `Executor appointment creation failed company=${context.companyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        return this.noBookingResult(
          'Foreign key constraint prevented appointment creation.',
        );
      }
      return this.noBookingResult(
        'Appointment creation failed; see logs for details.',
      );
    }
  }

  private async resolveOrganizer(companyId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return owner?.id ?? null;
  }

  private async resolvePreferredStaff(
    companyId: string,
    resolvedStaff: RetrievedStaff[],
    staffNameHint: string | undefined,
  ): Promise<string | null> {
    if (resolvedStaff.length > 0) return resolvedStaff[0].id;
    if (!staffNameHint) return null;

    const tokens = staffNameHint
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1);
    if (tokens.length === 0) return null;

    const rows = await this.prisma.staff.findMany({
      where: {
        companyId,
        isActive: true,
        OR: tokens.flatMap((t) => [
          { firstName: { contains: t, mode: 'insensitive' as const } },
          { lastName: { contains: t, mode: 'insensitive' as const } },
        ]),
      },
      select: { id: true },
      take: 1,
    });
    return rows[0]?.id ?? null;
  }

  private resolveSearchFrom(requestedIso: string | undefined, now: Date): Date {
    if (!requestedIso) return now;
    const parsed = new Date(requestedIso);
    if (Number.isNaN(parsed.valueOf())) return now;
    return parsed < now ? now : parsed;
  }

  private noBookingResult(reason: string): ExecutorAppointmentResult {
    return {
      created: false,
      appointmentId: null,
      scheduledAt: null,
      durationMinutes: null,
      staffId: null,
      staffName: null,
      alternatives: [],
      reason,
    };
  }

  // ---------------------------------------------------------------------------
  // PLACE_ORDER
  // ---------------------------------------------------------------------------

  /**
   * Create a PENDING Order for the conversation's contact. Validation:
   *   - decider.payload.order.productId must appear in the retriever context
   *     (or be the single product id on payload.productIds).
   *   - Product must be active and belong to this tenant (checked by the
   *     retriever already; we re-read to fetch price atomically).
   *   - Amount defaults to the product price if the decider gave none.
   */
  private async tryPlaceOrder(
    context: PipelineContext,
    decision: DeciderOutput,
    resolvedProducts: RetrievedProduct[],
  ): Promise<ExecutorOrderResult> {
    const hint = decision.payload.order;
    const productId =
      hint?.productId ??
      decision.payload.productIds[0] ??
      resolvedProducts[0]?.id ??
      null;

    if (!productId) {
      return this.noOrderResult(
        'No product referenced in decider payload; cannot place order.',
      );
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        price: true,
        companyId: true,
        isActive: true,
      },
    });
    if (!product || product.companyId !== context.companyId) {
      return this.noOrderResult(
        'Referenced product not found in this tenant.',
      );
    }
    if (!product.isActive) {
      return this.noOrderResult('Referenced product is inactive.');
    }

    const convo = await this.prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { contactId: true },
    });
    if (!convo?.contactId) {
      return this.noOrderResult(
        'Conversation has no contact; cannot create order.',
      );
    }

    const amount = hint?.amount ?? Number(product.price);
    if (!Number.isFinite(amount) || amount <= 0) {
      return this.noOrderResult('Resolved amount is not positive.');
    }

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            companyId: context.companyId,
            contactId: convo.contactId!,
            productId: product.id,
            status: OrderStatus.PENDING,
            amount: new Prisma.Decimal(amount),
            notes: hint?.notes ?? null,
          },
          select: { id: true, amount: true },
        });
        return created;
      });

      await this.lifecycle.transition(
        context.conversationId,
        ConversationLifecycleStatus.ORDER_PLACED,
      );

      return {
        created: true,
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        amount: order.amount.toString(),
        reason: 'Order created in PENDING status.',
      };
    } catch (error) {
      this.logger.error(
        `Executor order creation failed company=${context.companyId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.noOrderResult('Order creation failed; see logs.');
    }
  }

  private noOrderResult(reason: string): ExecutorOrderResult {
    return {
      created: false,
      orderId: null,
      productId: null,
      productName: null,
      amount: null,
      reason,
    };
  }

  // ---------------------------------------------------------------------------
  // REQUEST_PAYMENT
  // ---------------------------------------------------------------------------

  /**
   * Initiate a payment for the referenced order, using the company's
   * enabled payment methods. Preference is:
   *   1. Method hint from the decider, if enabled on the company.
   *   2. Stripe when available (better UX — hosted link).
   *   3. Wire transfer otherwise.
   */
  private async tryRequestPayment(
    context: PipelineContext,
    decision: DeciderOutput,
  ): Promise<ExecutorPaymentResult> {
    const hint = decision.payload.payment;
    const convo = await this.prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { contactId: true },
    });
    const contactId = convo?.contactId ?? null;
    if (!contactId) {
      return this.noPaymentResult(
        'Conversation has no contact; cannot initiate payment.',
      );
    }

    const orderId =
      hint?.orderId ??
      (await this.resolveLatestOrderId(context.companyId, contactId));
    if (!orderId) {
      return this.noPaymentResult(
        'No pending order found for this contact; nothing to pay for.',
      );
    }

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId: context.companyId },
      select: { stripeEnabled: true, wireTransferEnabled: true },
    });
    if (!settings) {
      return this.noPaymentResult(
        'CompanySettings missing; cannot determine enabled methods.',
      );
    }
    if (!settings.stripeEnabled && !settings.wireTransferEnabled) {
      return this.noPaymentResult('No payment methods enabled for this company.');
    }

    const method = this.pickPaymentMethod(hint?.method, settings);
    if (!method) {
      return this.noPaymentResult(
        'Decider requested an unavailable payment method.',
      );
    }

    // System-initiated flow — we use the company owner as the authenticated
    // caller for tenant assertion. PaymentsService receives a synthetic
    // `AuthenticatedUser` because REST auth is absent in the pipeline.
    const owner = await this.resolveOwner(context.companyId);
    if (!owner) {
      return this.noPaymentResult(
        'No active owner user for company; cannot attribute payment.',
      );
    }

    const pseudoCaller: AuthenticatedUser = {
      id: owner,
      supabaseId: owner,
      email: '',
      role: 'CLIENT',
      companyId: context.companyId,
    };

    try {
      const response = await this.payments.initiate(
        { orderId, method },
        pseudoCaller,
      );
      return {
        initiated: true,
        paymentId: response.id,
        method: response.method,
        checkoutUrl: response.checkoutUrl ?? null,
        wireInstructions: response.wireInstructions ?? null,
        orderId: response.orderId,
        reason: 'Payment initiated.',
      };
    } catch (error) {
      this.logger.error(
        `Executor payment initiation failed order=${orderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.noPaymentResult(
        error instanceof Error
          ? `Payment initiation failed: ${error.message}`
          : 'Payment initiation failed.',
      );
    }
  }

  private pickPaymentMethod(
    preferred: 'STRIPE' | 'WIRE_TRANSFER' | undefined,
    settings: { stripeEnabled: boolean; wireTransferEnabled: boolean },
  ): PaymentMethod | null {
    if (preferred === 'STRIPE' && settings.stripeEnabled) {
      return PaymentMethod.STRIPE;
    }
    if (preferred === 'WIRE_TRANSFER' && settings.wireTransferEnabled) {
      return PaymentMethod.WIRE_TRANSFER;
    }
    if (settings.stripeEnabled) return PaymentMethod.STRIPE;
    if (settings.wireTransferEnabled) return PaymentMethod.WIRE_TRANSFER;
    return null;
  }

  private async resolveLatestOrderId(
    companyId: string,
    contactId: string,
  ): Promise<string | null> {
    const order = await this.prisma.order.findFirst({
      where: {
        companyId,
        contactId,
        status: { in: [OrderStatus.PENDING, OrderStatus.CONFIRMED] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return order?.id ?? null;
  }

  private async resolveOwner(companyId: string): Promise<string | null> {
    const owner = await this.prisma.user.findFirst({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return owner?.id ?? null;
  }

  private noPaymentResult(reason: string): ExecutorPaymentResult {
    return {
      initiated: false,
      paymentId: null,
      method: null,
      checkoutUrl: null,
      wireInstructions: null,
      orderId: null,
      reason,
    };
  }
}

function toAlternative(slot: {
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  staffName: string;
}): ExecutorAppointmentAlternative {
  return {
    startsAt: slot.startsAt.toISOString(),
    endsAt: slot.endsAt.toISOString(),
    staffId: slot.staffId,
    staffName: slot.staffName,
  };
}

class StaleSlotError extends Error {
  constructor() {
    super('stale_slot');
    this.name = 'StaleSlotError';
  }
}
