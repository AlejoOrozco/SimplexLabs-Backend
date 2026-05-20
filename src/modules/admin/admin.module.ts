import { Module, OnModuleInit } from '@nestjs/common';
import { Channel, Prisma } from '@prisma/client';
import { AgentsModule } from '../agents/agents.module';
import { PipelineService } from '../agents/pipeline/pipeline.service';
import { FailedTaskService } from '../../common/reliability/failed-task.service';
import { FailedTasksController } from './failed-tasks.controller';
import type { PipelineContext } from '../agents/pipeline/pipeline-types';
import { NotificationsModule } from '../notifications/notifications.module';
import { CuidParamPipe } from '../../common/pipes/cuid-param.pipe';
import { AdminService } from './admin.service';
import { AdminOnboardingController } from './admin-onboarding.controller';
import { AdminCompaniesController } from './admin-companies.controller';
import { AdminClientUsersController } from './admin-client-users.controller';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminDashboardService } from './dashboard/admin-dashboard.service';
import { AdminClientDetailService } from './dashboard/admin-client-detail.service';
import { AdminPipelineFailuresService } from './admin-pipeline-failures.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

/**
 * Admin module (Phase 8).
 *
 * Hosts SUPER_ADMIN-only operational surfaces. Also responsible for
 * registering DLQ replay handlers on bootstrap so {@link FailedTaskService}
 * can dispatch replays back into the right feature without itself
 * importing feature modules (cyclic-import avoidance).
 *
 * New task types register a handler here — keep this module narrow and
 * feature-agnostic.
 */
@Module({
  imports: [AgentsModule, NotificationsModule, SubscriptionsModule],
  controllers: [
    FailedTasksController,
    AdminOnboardingController,
    AdminCompaniesController,
    AdminClientUsersController,
    AdminDashboardController,
  ],
  providers: [
    AdminService,
    AdminDashboardService,
    AdminClientDetailService,
    AdminPipelineFailuresService,
    CuidParamPipe,
  ],
})
export class AdminModule implements OnModuleInit {
  constructor(
    private readonly failedTasks: FailedTaskService,
    private readonly pipeline: PipelineService,
  ) {}

  onModuleInit(): void {
    this.failedTasks.registerHandler(
      'pipeline.run',
      async (payload: Prisma.JsonValue): Promise<string> => {
        const ctx = parsePipelineRunPayload(payload);
        const result = await this.pipeline.run(ctx);
        return (
          result.outboundMessageId ??
          `pipeline.skipped:${result.skipReason ?? 'unknown'}`
        );
      },
    );
  }
}

/**
 * Defensive parse: the DLQ payload originated from our own producer but
 * we still validate shape at the replay boundary so a corrupted row can
 * never silently dispatch a pipeline run with undefined fields.
 */
function parsePipelineRunPayload(payload: Prisma.JsonValue): PipelineContext {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('pipeline.run payload must be a JSON object');
  }
  const obj = payload as Record<string, unknown>;
  const inbound = obj.inbound;
  if (
    typeof obj.companyId !== 'string' ||
    typeof obj.conversationId !== 'string' ||
    typeof obj.messageId !== 'string' ||
    typeof obj.channel !== 'string' ||
    !inbound ||
    typeof inbound !== 'object' ||
    Array.isArray(inbound)
  ) {
    throw new Error('pipeline.run payload missing required fields');
  }
  const inboundObj = inbound as Record<string, unknown>;
  if (
    typeof inboundObj.content !== 'string' ||
    typeof inboundObj.metaMessageId !== 'string' ||
    typeof inboundObj.from !== 'string'
  ) {
    throw new Error('pipeline.run payload.inbound malformed');
  }
  if (!(obj.channel in Channel)) {
    throw new Error(`pipeline.run payload.channel unknown=${obj.channel}`);
  }
  return {
    companyId: obj.companyId,
    conversationId: obj.conversationId,
    messageId: obj.messageId,
    channel: obj.channel as Channel,
    inbound: {
      content: inboundObj.content,
      metaMessageId: inboundObj.metaMessageId,
      from: inboundObj.from,
    },
  };
}
