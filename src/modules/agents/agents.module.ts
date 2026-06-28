import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OpenAiCompletionService } from './providers/openai-completion.service';
import { PromptResolverService } from './prompts/prompt-resolver.service';
import { AgentDefaultsService } from './bootstrap/agent-defaults.service';
import { AnalyzerService } from './steps/analyzer.service';
import { RetrieverService } from './steps/retriever.service';
import { DeciderService } from './steps/decider.service';
import { ExecutorService } from './steps/executor.service';
import { ResponderService } from './steps/responder.service';
import { PipelineService } from './pipeline/pipeline.service';
import { AgentConfigService } from './config/agent-config.service';
import { AgentKbService } from './knowledge-base/agent-kb.service';

/**
 * AgentsModule wires the 5-step agent pipeline:
 *
 *   webhook inbound → PipelineService
 *     → AnalyzerService  (OpenAI JSON)
 *     → RetrieverService (Prisma only)
 *     → DeciderService   (OpenAI JSON)
 *     → ExecutorService  (deterministic)
 *     → ResponderService (OpenAI text)
 *   → persist AgentRun + outbound Message
 *   → WhatsAppSenderService.sendTextMessage
 *
 * Uses `forwardRef(WebhooksModule)` because WebhooksModule depends on
 * AgentsModule (for pipeline trigger) and AgentsModule depends on
 * WhatsAppSenderService from WebhooksModule (for outbound sending).
 */
@Module({
  imports: [
    PrismaModule,
    RealtimeModule,
    SchedulingModule,
    ConversationsModule,
    PaymentsModule,
    NotificationsModule,
    forwardRef(() => WebhooksModule),
  ],
  providers: [
    OpenAiCompletionService,
    PromptResolverService,
    AgentDefaultsService,
    AnalyzerService,
    RetrieverService,
    DeciderService,
    ExecutorService,
    ResponderService,
    PipelineService,
    AgentConfigService,
    AgentKbService,
  ],
  exports: [
    PipelineService,
    AgentDefaultsService,
    AgentConfigService,
    AgentKbService,
  ],
})
export class AgentsModule {}
