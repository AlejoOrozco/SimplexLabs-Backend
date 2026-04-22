import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { getCorrelationId } from '../observability/correlation-context';

/**
 * Canonical API error taxonomy (Phase 8).
 *
 * The frontend branches on `error.code`, not on `message` or HTTP status
 * alone. Codes are stable contracts — adding a new one is additive,
 * changing an existing one's semantics is a breaking change.
 *
 *   validation_failed      → DTO failed class-validator rules
 *   unauthorized           → no/invalid credentials (401)
 *   forbidden              → authenticated but not allowed (403)
 *   not_found              → resource missing (404)
 *   conflict               → unique constraint / illegal state (409)
 *   rate_limited           → throttler rejection (429)
 *   payload_too_large      → body-size cap hit (413)
 *   bad_request            → all other 400s (malformed pagination, etc.)
 *   illegal_state          → lifecycle transition refused
 *   internal               → anything non-HttpException — intentionally opaque
 */
export type ApiErrorCode =
  | 'validation_failed'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'bad_request'
  | 'illegal_state'
  | 'internal';

interface ApiErrorBody {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly message: string | string[];
  readonly error: string;
  readonly path: string;
  readonly timestamp: string;
  readonly correlationId: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly isProduction =
    (process.env.NODE_ENV ?? 'development') === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    let code: ApiErrorCode = 'internal';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const res = exceptionResponse as Record<string, unknown>;
        message = (res.message as string | string[]) ?? message;
        error = (res.error as string) ?? error;
      }
      code = mapStatusToCode(status, message);
    } else if (exception instanceof Error) {
      // Never leak internal error messages/stacks in production responses;
      // they're logged server-side where operators can correlate by id.
      this.logger.error(exception.message, exception.stack);
      if (!this.isProduction) {
        message = exception.message;
      }
    }

    const body: ApiErrorBody = {
      statusCode: status,
      code,
      message,
      error,
      path: request.url,
      timestamp: new Date().toISOString(),
      correlationId: getCorrelationId(),
    };

    response.status(status).json(body);
  }
}

function mapStatusToCode(
  status: number,
  message: string | string[],
): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return Array.isArray(message) ? 'validation_failed' : 'bad_request';
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'payload_too_large';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'rate_limited';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'illegal_state';
    default:
      return 'internal';
  }
}
