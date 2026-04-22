import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { MetaSenderService } from './meta-sender.service';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, MetaSenderService],
  exports: [WebhooksService, MetaSenderService],
})
export class WebhooksModule {}
