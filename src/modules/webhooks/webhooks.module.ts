import { forwardRef, Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WhatsAppSenderService } from './whatsapp-sender.service';
import { TwilioWebhookService } from './twilio-webhook.service';
import { TwilioSignatureGuard } from './twilio-signature.guard';
import { AgentsModule } from '../agents/agents.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    RealtimeModule,
    ChannelsModule,
    forwardRef(() => AgentsModule),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WhatsAppSenderService,
    TwilioWebhookService,
    TwilioSignatureGuard,
  ],
  exports: [WebhooksService, WhatsAppSenderService],
})
export class WebhooksModule {}
