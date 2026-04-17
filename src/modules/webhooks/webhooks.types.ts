/**
 * Structural types describing the Meta (WhatsApp/Instagram/Messenger)
 * webhook payload. These are intentionally minimal — unknown fields pass
 * through untouched so future Meta additions are not silently dropped.
 */

export interface MetaWebhookContact {
  wa_id: string;
  profile?: { name?: string };
}

export interface MetaWebhookMessage {
  id: string;
  from: string;
  type: string;
  timestamp: string;
  text?: { body: string };
}

export interface MetaWebhookChange {
  field: string;
  value: {
    messaging_product?: string;
    contacts?: MetaWebhookContact[];
    messages?: MetaWebhookMessage[];
  };
}

export interface MetaWebhookEntry {
  id: string;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookPayload {
  object: string;
  entry: MetaWebhookEntry[];
}

/**
 * Runtime guard — the payload arrives as `unknown` from Express and must be
 * narrowed before any field access.
 */
export function isMetaWebhookPayload(
  value: unknown,
): value is MetaWebhookPayload {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  return typeof candidate.object === 'string' && Array.isArray(candidate.entry);
}
