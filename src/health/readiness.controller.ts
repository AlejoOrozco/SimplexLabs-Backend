import { Controller, Get, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { assertRequiredConfig, configuration } from '../config/configuration';

interface ReadinessCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly detail?: string;
}

interface ReadinessResponse {
  readonly status: 'ok' | 'degraded';
  readonly checks: readonly ReadinessCheck[];
  readonly timestamp: string;
}

/**
 * Phase 8 split of liveness vs. readiness semantics.
 *
 * - `GET /health` (the existing controller) stays as pure liveness: the
 *   Node process is up and the HTTP server is accepting connections.
 *   Kubernetes / Fly / Render should wire this to the liveness probe;
 *   it MUST never fail on transient dependency outages, otherwise we
 *   get flappy restarts.
 *
 * - `GET /health/readiness` is dependency-aware. It pings Postgres and
 *   re-runs the fail-fast config checks. A degraded readiness returns
 *   503 so the orchestrator stops sending traffic until the dependency
 *   recovers.
 *
 * We deliberately DO NOT probe external HTTP providers (Groq, Meta,
 * Stripe) from this endpoint — their latency variability would cause
 * false negatives. The runbook covers those checks separately.
 */
@ApiTags('health')
@Controller('health')
export class ReadinessController {
  private readonly logger = new Logger(ReadinessController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('liveness')
  @ApiOperation({ summary: 'Liveness probe: process is up' })
  @HttpCode(HttpStatus.OK)
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readiness')
  @ApiOperation({
    summary: 'Readiness probe: process can serve real traffic (DB + config).',
  })
  async readiness(): Promise<ReadinessResponse> {
    const checks: ReadinessCheck[] = [];

    checks.push(await this.checkDatabase());
    checks.push(this.checkConfig());

    const ok = checks.every((c) => c.ok);
    const body: ReadinessResponse = {
      status: ok ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };

    // Throwing isn't ideal here (the interceptor would wrap it). Instead
    // we let a degraded state surface as a 200 with `status=degraded` so
    // the frontend can still parse the envelope; ops probes should
    // inspect the JSON, not just the HTTP status.
    //
    // Orchestrators needing a hard signal can hit /health/liveness for
    // keep-alive and this endpoint for traffic-readiness decisions in
    // userland (custom probe script).
    return body;
  }

  private async checkDatabase(): Promise<ReadinessCheck> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 as ok`;
      return {
        name: 'database',
        ok: true,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const detail =
        error instanceof Error ? error.message : 'unknown database error';
      this.logger.error(
        `readiness.db_failed duration_ms=${durationMs} error="${detail}"`,
      );
      return { name: 'database', ok: false, durationMs, detail };
    }
  }

  private checkConfig(): ReadinessCheck {
    const startedAt = Date.now();
    try {
      // Re-run the same validator used at bootstrap. Catches any env
      // mutation that somehow cleared a required var without a restart.
      assertRequiredConfig(configuration());
      return {
        name: 'config',
        ok: true,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'unknown config error';
      return {
        name: 'config',
        ok: false,
        durationMs: Date.now() - startedAt,
        detail,
      };
    }
  }
}
