/**
 * Centralized guardrail values for Phase 7 configuration surfaces.
 *
 * Everything a CLIENT can edit from the dashboard flows through these
 * bounds so we have a single source of truth for:
 *   - DTO-level validation (`class-validator`),
 *   - service-level sanity checks (defense in depth),
 *   - operator docs / Swagger examples.
 *
 * Changing a limit here must trigger a frontend contract revision.
 */

export const AGENT_NAME_MAX = 80;

export const MESSAGE_MAX = 1_000;

export const LANGUAGE_WHITELIST = ['es', 'en'] as const;
export type SupportedLanguage = (typeof LANGUAGE_WHITELIST)[number];

/** Channels a client may toggle on their AgentConfig. */
export const CONFIGURABLE_CHANNELS = [
  'WHATSAPP',
  'INSTAGRAM',
  'MESSENGER',
] as const;
export type ConfigurableChannel = (typeof CONFIGURABLE_CHANNELS)[number];

export const SYSTEM_PROMPT_MIN = 20;
export const SYSTEM_PROMPT_MAX = 8_000;

export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;

/**
 * `1` is the deliberate floor — a 0-token completion is useless and some
 * providers reject it; we allow the retriever default (1) as a no-op prompt.
 */
export const MAX_TOKENS_MIN = 1;
export const MAX_TOKENS_MAX = 4_096;

/** Whitelist of provider models a client can pick. */
export const SUPPORTED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export const KB_TITLE_MAX = 200;
export const KB_CONTENT_MAX = 16_000;
export const KB_CATEGORY_MAX = 80;

/** Sanity cap for free-text search queries on KB listing. */
export const KB_SEARCH_MAX = 120;

/** Hard cap on the dry-run `simulatedMessage`. */
export const SANDBOX_MESSAGE_MAX = 2_000;

/**
 * Tightly strip control characters that break Prisma / Postgres TEXT storage
 * or allow prompt-injection smuggling in storage. Keeps newlines + tabs.
 */
export function sanitizeMultilineText(input: string): string {
  return input
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B-\u001F\u007F]/g, '')
    .trim();
}

/**
 * Stricter variant for single-line fields (titles, names, category).
 * Also collapses any whitespace run into a single space.
 */
export function sanitizeSingleLineText(input: string): string {
  return sanitizeMultilineText(input).replace(/\s+/g, ' ');
}
