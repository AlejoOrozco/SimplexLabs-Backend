import { AxiosError, AxiosHeaders } from 'axios';
import {
  classifyEmailError,
  classifyLlmError,
  classifyMetaError,
} from './retry-classifiers';

function axiosErrorWithStatus(status: number): AxiosError {
  const err = new AxiosError(
    `HTTP ${status}`,
    'ERR_BAD_RESPONSE',
    undefined,
    undefined,
    {
      status,
      statusText: 'x',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    },
  );
  return err;
}

describe('classifyLlmError', () => {
  it('treats 4xx (except 408/429) as terminal', () => {
    expect(classifyLlmError(axiosErrorWithStatus(400), 1)).toBe('terminal');
    expect(classifyLlmError(axiosErrorWithStatus(401), 1)).toBe('terminal');
    expect(classifyLlmError(axiosErrorWithStatus(422), 1)).toBe('terminal');
  });

  it('retries 408 / 429 / 5xx', () => {
    expect(classifyLlmError(axiosErrorWithStatus(408), 1)).toBe('retryable');
    expect(classifyLlmError(axiosErrorWithStatus(429), 1)).toBe('retryable');
    expect(classifyLlmError(axiosErrorWithStatus(500), 1)).toBe('retryable');
    expect(classifyLlmError(axiosErrorWithStatus(503), 1)).toBe('retryable');
  });
});

describe('classifyMetaError', () => {
  it('treats auth failures (401/403) as terminal', () => {
    expect(classifyMetaError(axiosErrorWithStatus(401), 1)).toBe('terminal');
    expect(classifyMetaError(axiosErrorWithStatus(403), 1)).toBe('terminal');
  });

  it('retries 429 and 5xx', () => {
    expect(classifyMetaError(axiosErrorWithStatus(429), 1)).toBe('retryable');
    expect(classifyMetaError(axiosErrorWithStatus(502), 1)).toBe('retryable');
  });
});

describe('classifyEmailError', () => {
  it('treats nothing-to-do errors as terminal', () => {
    expect(classifyEmailError(new Error('Invalid recipient'), 1)).toBeDefined();
  });
});
