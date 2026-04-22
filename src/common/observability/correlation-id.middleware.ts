import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithCorrelationId } from './correlation-context';

const HEADER_NAME = 'x-correlation-id';
// Accept UUIDs (v4 / v7) and 16+ hex chars from upstream trace systems.
// Anything else is discarded so we don't propagate attacker-controlled
// opaque strings into logs and downstream requests.
const SAFE_HEADER = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Request-scoped correlation id.
 *
 * Strategy:
 *   1. If an upstream sent a valid `x-correlation-id` header, reuse it
 *      so tracing across services is seamless.
 *   2. Otherwise mint a fresh UUID v4.
 *   3. Echo the chosen id back in the response header so the frontend
 *      can surface it in error toasts for support.
 *   4. Install the id into AsyncLocalStorage so every downstream log
 *      line (including fire-and-forget work spawned from the handler)
 *      can include it without threading the parameter through every
 *      function.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const fromHeader = req.headers[HEADER_NAME];
    const candidate = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
    const id =
      typeof candidate === 'string' && SAFE_HEADER.test(candidate)
        ? candidate
        : randomUUID();

    res.setHeader(HEADER_NAME, id);
    // Attach to the request too so interceptors that don't know about
    // AsyncLocalStorage can still read it off the request object.
    (req as Request & { correlationId?: string }).correlationId = id;

    runWithCorrelationId(id, () => next());
  }
}
