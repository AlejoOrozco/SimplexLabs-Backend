/**
 * Parse a model completion that is expected to contain JSON. Groq's
 * `response_format: json_object` guarantees syntactically valid JSON, but
 * we still defend against:
 *   - accidental markdown fences (```json ... ```)
 *   - leading/trailing chatter before the first `{`
 *   - empty responses
 *
 * Returns `unknown` so callers must explicitly validate the shape with a
 * type guard — we do not trust the LLM to return what it promised.
 */
export function parseJsonCompletion(raw: string): unknown {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Empty completion');
  }

  const stripped = stripCodeFences(raw).trim();
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  const candidate =
    first >= 0 && last > first ? stripped.slice(first, last + 1) : stripped;

  return JSON.parse(candidate) as unknown;
}

function stripCodeFences(raw: string): string {
  const fence = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/;
  const trimmed = raw.trim();
  const match = fence.exec(trimmed);
  return match ? match[1] : trimmed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

export function asStringArray(value: unknown): string[] {
  return isStringArray(value) ? value : [];
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
