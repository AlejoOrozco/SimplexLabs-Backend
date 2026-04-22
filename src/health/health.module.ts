import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadinessController } from './readiness.controller';

/**
 * Liveness endpoint (`GET /health`) stays unchanged for back-compat.
 * Phase 8 adds dedicated `/health/liveness` + `/health/readiness` with
 * dependency probes (see ReadinessController for semantics).
 */
@Module({
  controllers: [HealthController, ReadinessController],
})
export class HealthModule {}
