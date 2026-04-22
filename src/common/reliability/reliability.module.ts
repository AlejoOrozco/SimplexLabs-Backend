import { Global, Module } from '@nestjs/common';
import { WebhookDedupeService } from './webhook-dedupe.service';
import { RetryPolicyService } from './retry-policy.service';
import { FailedTaskService } from './failed-task.service';

/**
 * Phase 8 reliability toolkit. Kept as a standalone global module so
 * feature modules can inject these without each having to import a
 * long relative path.
 *
 * Contents:
 *   - WebhookDedupeService: INSERT-based idempotency on provider events.
 *   - RetryPolicyService: bounded exp-backoff + jitter runner.
 *   - FailedTaskService: dead-letter capture + admin replay orchestration.
 */
@Global()
@Module({
  providers: [WebhookDedupeService, RetryPolicyService, FailedTaskService],
  exports: [WebhookDedupeService, RetryPolicyService, FailedTaskService],
})
export class ReliabilityModule {}
