import { BadRequestException } from '@nestjs/common';
import {
  ABSOLUTE_MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
  resolvePagination,
} from './pagination';

describe('resolvePagination', () => {
  it('applies defaults when nothing is provided', () => {
    expect(resolvePagination({})).toEqual({
      limit: DEFAULT_PAGE_LIMIT,
      offset: 0,
    });
  });

  it('respects per-endpoint defaultLimit', () => {
    expect(resolvePagination({ defaultLimit: 10 })).toEqual({
      limit: 10,
      offset: 0,
    });
  });

  it('rejects negative offsets', () => {
    expect(() => resolvePagination({ offset: -1 })).toThrow(BadRequestException);
  });

  it('rejects zero/negative limits', () => {
    expect(() => resolvePagination({ limit: 0 })).toThrow(BadRequestException);
    expect(() => resolvePagination({ limit: -5 })).toThrow(BadRequestException);
  });

  it('rejects limit above ABSOLUTE_MAX', () => {
    expect(() =>
      resolvePagination({ limit: ABSOLUTE_MAX_PAGE_LIMIT + 1 }),
    ).toThrow(BadRequestException);
  });

  it('clamps against endpoint-specific maxLimit', () => {
    expect(() => resolvePagination({ limit: 50, maxLimit: 20 })).toThrow(
      BadRequestException,
    );
  });

  it('refuses to silently exceed ABSOLUTE_MAX via maxLimit', () => {
    expect(() =>
      resolvePagination({ maxLimit: ABSOLUTE_MAX_PAGE_LIMIT + 10 }),
    ).toThrow();
  });
});
