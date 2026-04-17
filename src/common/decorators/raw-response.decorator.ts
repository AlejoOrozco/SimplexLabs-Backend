import { SetMetadata } from '@nestjs/common';

/**
 * Marker metadata key read by `ResponseInterceptor` to bypass the standard
 * `{ success, data, timestamp }` envelope. Use sparingly — only for routes
 * where the wire protocol requires a raw body (e.g. Meta webhook challenge
 * echo, file downloads).
 */
export const RAW_RESPONSE_KEY = 'raw_response';

export const RawResponse = (): MethodDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);
