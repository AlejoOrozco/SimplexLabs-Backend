import { BadRequestException } from '@nestjs/common';
import { ConversationLifecycleStatus } from '@prisma/client';

/**
 * Centralised lifecycle transition grammar.
 *
 * Phase 1 spread lifecycle `updateMany` calls across payments,
 * appointments, the pipeline, and the auto-close job. Each call site
 * implicitly trusted its business context to only set a sensible
 * next state. Phase 8 consolidates the rules here so illegal jumps
 * (e.g. PAYMENT_CONFIRMED → NEW) fail loudly at runtime.
 *
 * Semantics:
 *   - The keys are the current status.
 *   - Each value is the set of statuses we will accept as an explicit
 *     forward move for that source.
 *   - Any source → itself is permitted (the centralized mutator no-ops).
 *   - NEEDS_ATTENTION is reachable from any non-terminal state — it's
 *     how the operator surfaces agent failures.
 *   - Closed states (AUTO_CLOSED_INACTIVE, CLOSED_BY_CLIENT) admit no
 *     further transitions except via a fresh conversation reopen at the
 *     ingestion layer.
 *
 * This grammar is intentionally permissive: it rejects nonsense moves
 * without blocking legitimate product flows. Tighten iteratively.
 */
type LifecycleMap = Readonly<
  Record<ConversationLifecycleStatus, ReadonlySet<ConversationLifecycleStatus>>
>;

const ANY_NON_TERMINAL: ReadonlySet<ConversationLifecycleStatus> = new Set([
  ConversationLifecycleStatus.AGENT_ANALYZING,
  ConversationLifecycleStatus.INTERESTED,
  ConversationLifecycleStatus.APPOINTMENT_PENDING,
  ConversationLifecycleStatus.APPOINTMENT_BOOKED,
  ConversationLifecycleStatus.ORDER_PLACED,
  ConversationLifecycleStatus.PAYMENT_INITIATED,
  ConversationLifecycleStatus.PAYMENT_PENDING_REVIEW,
  ConversationLifecycleStatus.PAYMENT_CONFIRMED,
  ConversationLifecycleStatus.NEEDS_ATTENTION,
  ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
  ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
  ConversationLifecycleStatus.CLOSED_BY_CLIENT,
]);

const TRANSITIONS: LifecycleMap = {
  [ConversationLifecycleStatus.NEW]: ANY_NON_TERMINAL,
  [ConversationLifecycleStatus.AGENT_ANALYZING]: new Set([
    ConversationLifecycleStatus.INTERESTED,
    ConversationLifecycleStatus.APPOINTMENT_PENDING,
    ConversationLifecycleStatus.APPOINTMENT_BOOKED,
    ConversationLifecycleStatus.ORDER_PLACED,
    ConversationLifecycleStatus.PAYMENT_INITIATED,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.INTERESTED]: new Set([
    ConversationLifecycleStatus.APPOINTMENT_PENDING,
    ConversationLifecycleStatus.APPOINTMENT_BOOKED,
    ConversationLifecycleStatus.ORDER_PLACED,
    ConversationLifecycleStatus.PAYMENT_INITIATED,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.APPOINTMENT_PENDING]: new Set([
    ConversationLifecycleStatus.APPOINTMENT_BOOKED,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.APPOINTMENT_BOOKED]: new Set([
    ConversationLifecycleStatus.ORDER_PLACED,
    ConversationLifecycleStatus.PAYMENT_INITIATED,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.ORDER_PLACED]: new Set([
    ConversationLifecycleStatus.PAYMENT_INITIATED,
    ConversationLifecycleStatus.PAYMENT_PENDING_REVIEW,
    ConversationLifecycleStatus.PAYMENT_CONFIRMED,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.PAYMENT_INITIATED]: new Set([
    ConversationLifecycleStatus.PAYMENT_PENDING_REVIEW,
    ConversationLifecycleStatus.PAYMENT_CONFIRMED,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.PAYMENT_PENDING_REVIEW]: new Set([
    ConversationLifecycleStatus.PAYMENT_CONFIRMED,
    ConversationLifecycleStatus.PAYMENT_INITIATED,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.PAYMENT_CONFIRMED]: new Set([
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
    ConversationLifecycleStatus.CLOSED_BY_CLIENT,
  ]),
  [ConversationLifecycleStatus.NEEDS_ATTENTION]: ANY_NON_TERMINAL,
  [ConversationLifecycleStatus.AGENT_REPLIED_WAITING]: ANY_NON_TERMINAL,
  [ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE]: new Set([
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.NEW,
  ]),
  [ConversationLifecycleStatus.CLOSED_BY_CLIENT]: new Set([
    ConversationLifecycleStatus.AGENT_ANALYZING,
    ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    ConversationLifecycleStatus.NEEDS_ATTENTION,
    ConversationLifecycleStatus.NEW,
  ]),
};

export function canTransitionLifecycle(
  from: ConversationLifecycleStatus,
  to: ConversationLifecycleStatus,
): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].has(to);
}

export function assertLifecycleTransition(
  from: ConversationLifecycleStatus,
  to: ConversationLifecycleStatus,
): void {
  if (!canTransitionLifecycle(from, to)) {
    throw new BadRequestException(
      `Illegal lifecycle transition ${from} → ${to}. Allowed from ${from}: ${Array.from(TRANSITIONS[from]).join(', ') || '(none)'}`,
    );
  }
}
