import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { GroqService } from './providers/groq.service';
import { PromptResolverService } from './prompts/prompt-resolver.service';
import { AgentDefaultsService } from './bootstrap/agent-defaults.service';
import { AnalyzerService } from './steps/analyzer.service';
import { RetrieverService } from './steps/retriever.service';
import { DeciderService } from './steps/decider.service';
import { ExecutorService } from './steps/executor.service';
import { ResponderService } from './steps/responder.service';
import { PipelineService } from './pipeline/pipeline.service';
import { AgentConfigController } from './config/agent-config.controller';
import { AgentConfigService } from './config/agent-config.service';
import { AgentPromptsController } from './prompts/agent-prompts.controller';
import { AgentPromptsService } from './prompts/agent-prompts.service';
import { AgentKbController } from './knowledge-base/agent-kb.controller';
import { AgentKbService } from './knowledge-base/agent-kb.service';
import { SandboxController } from './sandbox/sandbox.controller';
import { SandboxService } from './sandbox/sandbox.service';

/**
 * AgentsModule wires the 5-step agent pipeline:
 *
 *   webhook inbound → PipelineService
 *     → AnalyzerService  (Groq JSON)
 *     → RetrieverService (Prisma only)
 *     → DeciderService   (Groq JSON)
 *     → ExecutorService  (deterministic)
 *     → ResponderService (Groq text)
 *   → persist AgentRun + outbound Message
 *   → MetaSenderService.sendWhatsappText
 *
 * Uses `forwardRef(WebhooksModule)` because WebhooksModule depends on
 * AgentsModule (for pipeline trigger) and AgentsModule depends on
 * MetaSenderService from WebhooksModule (for outbound sending).
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
  controllers: [
    AgentsController,
    AgentConfigController,
    AgentPromptsController,
    AgentKbController,
    SandboxController,
  ],
  providers: [
    AgentsService,
    GroqService,
    PromptResolverService,
    AgentDefaultsService,
    AnalyzerService,
    RetrieverService,
    DeciderService,
    ExecutorService,
    ResponderService,
    PipelineService,
    AgentConfigService,
    AgentPromptsService,
    AgentKbService,
    SandboxService,
  ],
  exports: [
    PipelineService,
    AgentDefaultsService,
    AgentConfigService,
    AgentPromptsService,
    AgentKbService,
    SandboxService,
  ],
})
export class AgentsModule {}
