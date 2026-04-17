import type { Request } from 'express';

export function getCookieValue(
  cookies: Request['cookies'],
  name: string,
): string | undefined {
  if (!cookies || typeof cookies !== 'object') return undefined;
  const value: unknown = Reflect.get(cookies, name);
  return typeof value === 'string' ? value : undefined;
}
