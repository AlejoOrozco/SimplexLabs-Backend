import { AxiosError, isAxiosError } from 'axios';
import type { RetryClassification } from './retry-policy.service';

/**
 * Shared retry classifiers. Each integration adapter imports the one
 * that matches its failure model. Keeping them here means upgrades
 * (e.g. OpenAI starts surfacing a new 4xx we should retry) are one-line
 * changes that apply uniformly.
 */

const RETRYABLE_HTTP_STATUSES = new Set<number>([
  408, // Request Timeout
  425, // Too Early
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Classifier for OpenAI-compatible LLM providers. 4xx other than
 * 408/425/429 are treated as terminal (bad prompt, bad model, auth).
 */
export function classifyLlmError(
  error: unknown,
  _attempt: number,
): RetryClassification {
  if (isAxiosError(error)) {
    const status = (error as AxiosError).response?.status;
    if (status === undefined) return 'retryable'; // network/DNS/timeout
    if (RETRYABLE_HTTP_STATUSES.has(status)) return 'retryable';
    return 'terminal';
  }
  // Timeouts surface as non-axios errors occasionally; retry once more.
  if (error instanceof Error && /timeout|ETIMEDOUT|ECONNRESET/i.test(error.message)) {
    return 'retryable';
  }
  return 'terminal';
}

/**
 * Classifier for Meta Graph API. Same status map as LLM plus a guard for
 * the "temporary rate limit" subcodes Meta sometimes returns as 400.
 */
export function classifyMetaError(
  error: unknown,
  _attempt: number,
): RetryClassification {
  if (!isAxiosError(error)) {
    if (error instanceof Error && /timeout|ECONNRESET|ETIMEDOUT/i.test(error.message)) {
      return 'retryable';
    }
    return 'terminal';
  }

  const axiosError = error as AxiosError<{
    error?: { code?: number; error_subcode?: number };
  }>;
  const status = axiosError.response?.status;
  if (status === undefined) return 'retryable';
  if (RETRYABLE_HTTP_STATUSES.has(status)) return 'retryable';

  // Meta "rate limit hit" family (#4, #17, #32, #613).
  const code = axiosError.response?.data?.error?.code;
  const RATE_LIMIT_CODES = new Set<number>([4, 17, 32, 613]);
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    return 'retryable';
  }

  return 'terminal';
}

/**
 * Classifier for SMTP email send. Auth / invalid-recipient failures are
 * terminal; everything else (connection, greylisting, 4xx temp failures)
 * is retryable.
 */
export function classifyEmailError(
  error: unknown,
  _attempt: number,
): RetryClassification {
  if (!(error instanceof Error)) return 'terminal';
  const code = (error as Error & { code?: string }).code;
  const msg = error.message.toLowerCase();

  if (code === 'EAUTH' || msg.includes('invalid login')) return 'terminal';
  if (msg.includes('no recipients defined')) return 'terminal';
  if (msg.includes('invalid recipient')) return 'terminal';

  return 'retryable';
}

const RESEND_RETRYABLE_CODES = new Set<string>([
  'rate_limit_exceeded',
  'internal_server_error',
  'application_error',
]);

const RESEND_TERMINAL_CODES = new Set<string>([
  'invalid_api_key',
  'restricted_api_key',
  'missing_api_key',
  'invalid_from_address',
  'validation_error',
  'missing_required_field',
  'invalid_parameter',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'security_error',
  'invalid_access',
]);

/**
 * Classifier for Resend HTTP API errors surfaced by EmailService.
 */
export function classifyResendError(
  error: unknown,
  _attempt: number,
): RetryClassification {
  if (!(error instanceof Error)) return 'terminal';

  const resendCode = (error as Error & { resendCode?: string }).resendCode;
  if (resendCode !== undefined) {
    if (RESEND_TERMINAL_CODES.has(resendCode)) return 'terminal';
    if (RESEND_RETRYABLE_CODES.has(resendCode)) return 'retryable';
  }

  if (/timeout|ETIMEDOUT|ECONNRESET/i.test(error.message)) {
    return 'retryable';
  }

  return 'terminal';
}
