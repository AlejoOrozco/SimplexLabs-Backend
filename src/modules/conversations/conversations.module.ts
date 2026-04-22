import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationControlService } from './conversation-control.service';
import { ConversationLifecycleService } from './conversation-lifecycle.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [WebhooksModule, RealtimeModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ConversationControlService,
    ConversationLifecycleService,
  ],
  exports: [
    ConversationsService,
    ConversationControlService,
    ConversationLifecycleService,
  ],
})
export class ConversationsModule {}
