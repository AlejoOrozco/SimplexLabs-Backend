import { BadRequestException } from '@nestjs/common';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

/**
 * Central Payment state machine.
 *
 * Phase 5 supports two payment families — Stripe (automatic confirm via
 * webhook) and Wire Transfer (human approves after screenshot upload).
 * Each has its own valid initial state, so transitions diverge early:
 *
 *   STRIPE           : INITIATED    → CONFIRMED | FAILED | CANCELLED
 *                      CONFIRMED    → REFUNDED
 *   WIRE_TRANSFER    : AWAITING_SCREENSHOT → PENDING_REVIEW | CANCELLED
 *                      PENDING_REVIEW       → CONFIRMED | FAILED
 *                      CONFIRMED    → REFUNDED
 *
 * Terminal states (`FAILED`, `CANCELLED`, `REFUNDED`) admit no outbound
 * transitions. A helper rejects transitions into `CONFIRMED` or `REFUNDED`
 * unless the caller went through the legal source state.
 *
 * NOTE: REFUNDED is a *permitted* terminal; there's no refund engine in
 * Phase 5, but we allow the status so a future ops tool can mark it.
 */

/** Legal forward transitions, keyed by the *current* status. */
const COMMON_TRANSITIONS: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  [PaymentStatus.INITIATED]: [
    PaymentStatus.CONFIRMED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.AWAITING_SCREENSHOT]: [
    PaymentStatus.PENDING_REVIEW,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.PENDING_REVIEW]: [
    PaymentStatus.CONFIRMED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.CONFIRMED]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.CANCELLED]: [],
  [PaymentStatus.REFUNDED]: [],
};

/**
 * Method-specific valid *initial* statuses. Never returned by the DB state
 * machine — used only by the service when persisting a brand new Payment.
 */
export const INITIAL_STATUS_FOR_METHOD: Readonly<
  Record<PaymentMethod, PaymentStatus>
> = {
  [PaymentMethod.STRIPE]: PaymentStatus.INITIATED,
  [PaymentMethod.WIRE_TRANSFER]: PaymentStatus.AWAITING_SCREENSHOT,
};

/** Statuses from which no further state change is allowed. */
export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
]);

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): boolean {
  if (from === to) return false;
  return COMMON_TRANSITIONS[from].includes(to);
}

export function allowedNext(from: PaymentStatus): readonly PaymentStatus[] {
  return COMMON_TRANSITIONS[from];
}

/**
 * Throw a `BadRequestException` when a transition violates the state
 * machine. The error message lists the current + requested state so
 * clients (and logs) can debug without exposing internals.
 */
export function assertTransition(
  from: PaymentStatus,
  to: PaymentStatus,
): void {
  if (!canTransition(from, to)) {
    throw new BadRequestException(
      `Invalid payment transition ${from} → ${to}. Allowed from ${from}: ${
        COMMON_TRANSITIONS[from].join(', ') || '(terminal)'
      }`,
    );
  }
}
