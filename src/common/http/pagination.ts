import { BadRequestException } from '@nestjs/common';

/**
 * Global pagination ceilings.
 *
 * Every list endpoint that accepts a `limit` query param MUST resolve
 * it through {@link resolvePagination}. The ceilings are conservative:
 *   - 25 default keeps dashboards snappy on low-bandwidth connections.
 *   - 100 max protects against `limit=99999` probes.
 *
 * Raising a specific ceiling requires a deliberate override on the
 * endpoint (pass `maxLimit` to {@link resolvePagination}) and a
 * documented justification in the PR.
 */
export const DEFAULT_PAGE_LIMIT = 25;
export const ABSOLUTE_MAX_PAGE_LIMIT = 100;

export interface ResolvedPagination {
  readonly limit: number;
  readonly offset: number;
}

export function resolvePagination(input: {
  limit?: number | null;
  offset?: number | null;
  defaultLimit?: number;
  maxLimit?: number;
}): ResolvedPagination {
  const max = input.maxLimit ?? ABSOLUTE_MAX_PAGE_LIMIT;
  const def = input.defaultLimit ?? DEFAULT_PAGE_LIMIT;

  if (max > ABSOLUTE_MAX_PAGE_LIMIT) {
    throw new Error(
      `Endpoint attempted to raise maxLimit above ABSOLUTE_MAX_PAGE_LIMIT (${ABSOLUTE_MAX_PAGE_LIMIT}); fix the endpoint.`,
    );
  }

  const rawLimit = input.limit ?? def;
  const rawOffset = input.offset ?? 0;

  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    throw new BadRequestException('limit must be a positive integer');
  }
  if (!Number.isInteger(rawOffset) || rawOffset < 0) {
    throw new BadRequestException('offset must be a non-negative integer');
  }
  if (rawLimit > max) {
    throw new BadRequestException(
      `limit may not exceed ${max}; received ${rawLimit}`,
    );
  }

  return { limit: rawLimit, offset: rawOffset };
}
