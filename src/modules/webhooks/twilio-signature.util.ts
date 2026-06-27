import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates Twilio's `X-Twilio-Signature` header per their documented
 * HMAC-SHA1 scheme: sorted POST params appended to the full webhook URL.
 */
export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort();
  let payload = url;
  for (const key of sortedKeys) {
    payload += key + params[key];
  }

  const expected = createHmac('sha1', authToken)
    .update(Buffer.from(payload, 'utf-8'))
    .digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf-8');
  const providedBuf = Buffer.from(signature, 'utf-8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Normalizes Twilio WhatsApp addresses to `whatsapp:+E164` so inbound
 * routing and outbound sends use a single canonical shape.
 */
export function normalizeTwilioWhatsAppAddress(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('whatsapp:')) {
    const digits = trimmed.slice('whatsapp:'.length).replace(/\s/g, '');
    return digits.startsWith('+') ? `whatsapp:${digits}` : `whatsapp:+${digits}`;
  }
  const digits = trimmed.replace(/\s/g, '');
  return digits.startsWith('+') ? `whatsapp:${digits}` : `whatsapp:+${digits}`;
}

/** Strips the `whatsapp:` prefix for DB storage on ClientContact.phone. */
export function twilioAddressToPhone(raw: string): string {
  const normalized = normalizeTwilioWhatsAppAddress(raw);
  return normalized.slice('whatsapp:'.length);
}
