import { forwardRef, Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { MetaSenderService } from './meta-sender.service';
import { ChannelsModule } from '../channels/channels.module';
import { AgentsModule } from '../agents/agents.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [ChannelsModule, RealtimeModule, forwardRef(() => AgentsModule)],
  controllers: [WebhooksController],
  providers: [WebhooksService, MetaSenderService],
  exports: [WebhooksService, MetaSenderService],
})
export class WebhooksModule {}
