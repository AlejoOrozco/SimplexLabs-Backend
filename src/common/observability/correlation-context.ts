import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationContext {
  readonly correlationId: string;
  companyId?: string;
  conversationId?: string;
  messageId?: string;
  runId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/**
 * Entry-point used by the request middleware. Everything executed in
 * `fn` (including awaited promises) inherits the context — that's how
 * `getCorrelationContext()` works from deep inside the pipeline.
 */
export function runWithCorrelationId<T>(
  correlationId: string,
  fn: () => T,
): T {
  return storage.run({ correlationId }, fn);
}

/**
 * Fire-and-forget work (pipeline.run from webhook ingest) extends the
 * parent context with business ids so pipeline logs can be grouped. The
 * returned promise resolves with whatever `fn` returned so callers can
 * still `await` if they want to.
 */
export function runWithExtendedContext<T>(
  patch: Partial<Omit<CorrelationContext, 'correlationId'>>,
  fn: () => Promise<T>,
): Promise<T> {
  const current = storage.getStore();
  const next: CorrelationContext = current
    ? { ...current, ...patch }
    : { correlationId: 'unset', ...patch };
  return storage.run(next, fn);
}

export function getCorrelationContext(): CorrelationContext | null {
  return storage.getStore() ?? null;
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? 'unset';
}

/**
 * Build a single-line log prefix that is safe to concat after the
 * NestJS `[Logger]` tag. Designed to be greppable: every field uses
 * `key=value` with no spaces inside the value (so shell `awk` /
 * Loki label matchers can parse it without escaping).
 */
export function logContext(): string {
  const ctx = storage.getStore();
  if (!ctx) return '';
  const parts: string[] = [`cid=${ctx.correlationId}`];
  if (ctx.companyId) parts.push(`company=${ctx.companyId}`);
  if (ctx.conversationId) parts.push(`conversation=${ctx.conversationId}`);
  if (ctx.messageId) parts.push(`message=${ctx.messageId}`);
  if (ctx.runId) parts.push(`run=${ctx.runId}`);
  return parts.join(' ');
}
