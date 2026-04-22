import { RetryPolicyService } from './retry-policy.service';
import type { RetryClassification } from './retry-policy.service';

describe('RetryPolicyService', () => {
  const service = new RetryPolicyService();

  it('returns the value on first success without retrying', async () => {
    const fn = jest.fn(async () => 'ok');
    const result = await service.run(
      {
        operation: 'test',
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 4,
        classify: () => 'retryable',
      },
      fn,
    );
    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors up to maxAttempts', async () => {
    const fn = jest.fn();
    fn.mockRejectedValueOnce(new Error('boom1'));
    fn.mockRejectedValueOnce(new Error('boom2'));
    fn.mockResolvedValueOnce('ok');

    const result = await service.run(
      {
        operation: 'test',
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 4,
        classify: (): RetryClassification => 'retryable',
      },
      fn,
    );

    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry terminal errors', async () => {
    const fn = jest.fn(async () => {
      throw new Error('permanent');
    });
    await expect(
      service.run(
        {
          operation: 'test',
          maxAttempts: 5,
          baseDelayMs: 1,
          maxDelayMs: 4,
          classify: () => 'terminal',
        },
        fn,
      ),
    ).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects bounded retry count', async () => {
    const fn = jest.fn(async () => {
      throw new Error('always');
    });
    await expect(
      service.run(
        {
          operation: 'test',
          maxAttempts: 2,
          baseDelayMs: 1,
          maxDelayMs: 2,
          classify: () => 'retryable',
        },
        fn,
      ),
    ).rejects.toThrow('always');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
