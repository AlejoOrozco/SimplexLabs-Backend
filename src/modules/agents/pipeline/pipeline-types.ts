import type { Channel } from '@prisma/client';

/**
 * Immutable context every pipeline step receives. The orchestrator assembles
 * it once, up front, and passes it through all five steps.
 */
export interface PipelineContext {
  companyId: string;
  conversationId: string;
  messageId: string;
  channel: Channel;
  inbound: {
    /** The customer's message text (or synthesized caption for media). */
    content: string;
    /** Stable Meta id, used as idempotency key upstream. */
    metaMessageId: string;
    /** Customer phone / handle. */
    from: string;
  };
}

// -----------------------------------------------------------------------------
// Step 1 — Analyzer
// -----------------------------------------------------------------------------

export type AnalyzedLanguage = 'es' | 'en';
export type AnalyzedUrgency = 'low' | 'medium' | 'high';

export interface AnalyzerOutput {
  intent: string;
  language: AnalyzedLanguage;
  urgency: AnalyzedUrgency;
  summary: string;
  entities: {
    names: string[];
    dates: string[];
    products: string[];
    amounts: string[];
    staff: string[];
  };
}

// -----------------------------------------------------------------------------
// Step 2 — Retriever (data-only, no LLM)
// -----------------------------------------------------------------------------

export interface RetrievedKbEntry {
  id: string;
  title: string;
  content: string;
  category: string | null;
}

export interface RetrievedProduct {
  id: string;
  name: string;
  description: string | null;
  type: string;
  price: string;
}

export interface RetrievedStaff {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface RetrievedMessage {
  senderType: 'AGENT' | 'CONTACT' | 'HUMAN';
  content: string;
  sentAt: string;
}

export interface RetrieverOutput {
  knowledgeBase: RetrievedKbEntry[];
  products: RetrievedProduct[];
  staff: RetrievedStaff[];
  recentMessages: RetrievedMessage[];
}

// -----------------------------------------------------------------------------
// Step 3 — Decider
// -----------------------------------------------------------------------------

export const DECIDER_ACTIONS = [
  'REPLY',
  'REPLY_WITH_KB',
  'SUGGEST_PRODUCT',
  'SUGGEST_APPOINTMENT',
  'PLACE_ORDER',
  'REQUEST_PAYMENT',
  'ESCALATE',
  'NONE',
] as const;
export type DeciderAction = (typeof DECIDER_ACTIONS)[number];

export interface DeciderOutput {
  action: DeciderAction;
  reason: string;
  payload: {
    kbIds: string[];
    productIds: string[];
    staffIds: string[];
    /**
     * Optional scheduling hint emitted when `action = SUGGEST_APPOINTMENT`.
     * All fields are best-effort: the Executor validates, falls back to the
     * next available slot, and returns alternatives when the hint is stale.
     */
    appointment?: {
      /** ISO-8601 UTC timestamp the customer requested, if any. */
      requestedAtIso?: string;
      /** Free-text staff name the customer asked for. */
      staffName?: string;
      /** Proposed slot duration (minutes). Defaults to company setting. */
      durationMinutes?: number;
      /** Short title the organizer/UI can show. */
      title?: string;
    };
    /**
     * Optional ordering hint emitted when `action = PLACE_ORDER`. The
     * executor validates the product against the retriever context and
     * creates a PENDING Order for the conversation's contact.
     */
    order?: {
      /** Product id (must appear in the retriever context). */
      productId?: string;
      /** Explicit amount override; otherwise the product price is used. */
      amount?: number;
      /** Free-text note persisted on the order. */
      notes?: string;
    };
    /**
     * Optional payment hint emitted when `action = REQUEST_PAYMENT`. The
     * executor picks a legal payment method based on CompanySettings
     * (method hint is a preference, not a mandate).
     */
    payment?: {
      /** Payment method preference — falls back to the only enabled one. */
      method?: 'STRIPE' | 'WIRE_TRANSFER';
      /** Order id the agent wants to collect payment for. */
      orderId?: string;
    };
  };
}

// -----------------------------------------------------------------------------
// Step 4 — Executor
// -----------------------------------------------------------------------------

export interface ExecutorAppointmentAlternative {
  startsAt: string;
  endsAt: string;
  staffId: string;
  staffName: string;
}

export interface ExecutorAppointmentResult {
  /** `true` when a PENDING appointment row was created. */
  created: boolean;
  appointmentId: string | null;
  scheduledAt: string | null;
  durationMinutes: number | null;
  staffId: string | null;
  staffName: string | null;
  /**
   * When `created=false`, up to 3 suggested next slots so the Responder can
   * offer alternatives to the customer instead of dead-ending the flow.
   */
  alternatives: ExecutorAppointmentAlternative[];
  /** Human-readable reason (shown in logs + fed to Responder prompt context). */
  reason: string;
}

export interface ExecutorOrderResult {
  /** `true` when a PENDING Order row was created. */
  created: boolean;
  orderId: string | null;
  productId: string | null;
  productName: string | null;
  amount: string | null;
  reason: string;
}

export interface ExecutorPaymentResult {
  /** `true` when a Payment row was initiated (checkout URL OR wire row). */
  initiated: boolean;
  paymentId: string | null;
  method: 'STRIPE' | 'WIRE_TRANSFER' | null;
  /** Stripe hosted checkout URL when method = STRIPE. */
  checkoutUrl: string | null;
  /** Wire transfer instructions when method = WIRE_TRANSFER. */
  wireInstructions: string | null;
  orderId: string | null;
  reason: string;
}

export interface ExecutorOutput {
  action: DeciderAction;
  executed: boolean;
  deferred: boolean;
  deferredReason: string | null;
  /** Structured data the responder may use (resolved KB/product rows). */
  result: {
    resolvedKb: RetrievedKbEntry[];
    resolvedProducts: RetrievedProduct[];
    resolvedStaff: RetrievedStaff[];
    /** Populated only when `action = SUGGEST_APPOINTMENT`. */
    appointment?: ExecutorAppointmentResult;
    /** Populated only when `action = PLACE_ORDER`. */
    order?: ExecutorOrderResult;
    /** Populated only when `action = REQUEST_PAYMENT`. */
    payment?: ExecutorPaymentResult;
  };
}

// -----------------------------------------------------------------------------
// Step 5 — Responder
// -----------------------------------------------------------------------------

export interface ResponderOutput {
  text: string;
  language: AnalyzedLanguage;
  /** When true, `text` is the company's configured fallback, not a fresh LLM reply. */
  fallbackUsed: boolean;
}

// -----------------------------------------------------------------------------
// Aggregate result persisted onto AgentRun
// -----------------------------------------------------------------------------

export interface StepTokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

export interface PipelineResult {
  success: boolean;
  error: string | null;
  totalTokens: number;
  durationMs: number;
  responderText: string | null;
  outboundMessageId: string | null;
  /** True when the run was skipped by a pre-/mid-flight control gate. */
  skipped?: boolean;
  skipReason?: 'conversation_in_human_mode' | 'takeover_during_run';
}
