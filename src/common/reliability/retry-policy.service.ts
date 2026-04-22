import { Injectable, Logger } from '@nestjs/common';

/**
 * Outcome classification for a single attempt.
 *
 * The caller-provided `classify()` inspects the error and tells the
 * runner whether a further attempt is warranted. Non-retryable errors
 * terminate the loop immediately with the original cause — we NEVER
 * wrap the error so stack traces stay intact.
 */
export type RetryClassification = 'retryable' | 'terminal';

export interface RetryPolicy {
  /** Friendly name surfaced in logs. Required so failures are greppable. */
  readonly operation: string;
  /** Maximum total attempts (including the first). Must be >= 1. */
  readonly maxAttempts: number;
  /** Base delay (ms) before the 2nd attempt; grows exponentially. */
  readonly baseDelayMs: number;
  /** Hard cap on any single backoff step (ms). */
  readonly maxDelayMs: number;
  /**
   * Classifier — returns `'retryable'` to continue, `'terminal'` to stop.
   * Defaults to treating every error as retryable if omitted.
   */
  readonly classify?: (error: unknown, attempt: number) => RetryClassification;
}

export interface RetryResult<T> {
  readonly value: T;
  readonly attempts: number;
  readonly totalDurationMs: number;
}

/**
 * Standardized retry runner used by every external-boundary call. Prefer
 * this over hand-rolled loops so retry accounting, jitter, and log
 * shapes are consistent across Groq / Meta / Email / etc.
 *
 * Design rules:
 *   - Bounded: `maxAttempts` enforced strictly. No infinite retries.
 *   - Exponential backoff + full jitter (AWS Architecture-blog style).
 *   - Classifier-driven: the caller decides what is retryable — the
 *     runner has no integration-specific knowledge.
 *   - Transparent: on terminal failure the original error is rethrown;
 *     we never wrap it in a generic RuntimeException.
 */
@Injectable()
export class RetryPolicyService {
  private readonly logger = new Logger(RetryPolicyService.name);

  async run<T>(
    policy: RetryPolicy,
    fn: (attempt: number) => Promise<T>,
  ): Promise<RetryResult<T>> {
    if (policy.maxAttempts < 1) {
      throw new Error(
        `RetryPolicy for "${policy.operation}" requires maxAttempts >= 1`,
      );
    }

    const startedAt = Date.now();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        const value = await fn(attempt);
        return {
          value,
          attempts: attempt,
          totalDurationMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
        const classification =
          policy.classify?.(error, attempt) ?? 'retryable';

        if (classification === 'terminal') {
          this.logger.warn(
            `retry.terminal op=${policy.operation} attempt=${attempt}/${policy.maxAttempts} error="${describe(error)}"`,
          );
          throw error;
        }

        if (attempt >= policy.maxAttempts) {
          this.logger.warn(
            `retry.exhausted op=${policy.operation} attempts=${attempt} error="${describe(error)}"`,
          );
          throw error;
        }

        const delay = this.computeBackoff(policy, attempt);
        this.logger.debug(
          `retry.scheduled op=${policy.operation} attempt=${attempt}/${policy.maxAttempts} delay_ms=${delay} error="${describe(error)}"`,
        );
        await sleep(delay);
      }
    }

    // Unreachable — the loop above either returns or throws. Retained
    // for exhaustive typing so callers get `never` on this path.
    throw lastError ?? new Error(`retry.unreachable op=${policy.operation}`);
  }

  private computeBackoff(policy: RetryPolicy, attempt: number): number {
    const exp = policy.baseDelayMs * Math.pow(2, attempt - 1);
    const bounded = Math.min(exp, policy.maxDelayMs);
    // Full jitter: uniform in [0, bounded]. Prevents synchronised
    // retry storms from tripping upstream rate-limits.
    return Math.floor(Math.random() * bounded);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown_error';
}
