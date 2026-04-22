import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EmailService } from './adapters/email.service';
import { WhatsappNotificationAdapter } from './adapters/whatsapp-notification.adapter';
import { InactivityCloseJob } from './scheduler/inactivity-close.job';

/**
 * Phase 6: notifications + inactivity auto-close.
 *
 * Wiring summary:
 *   - RealtimeModule → emit `notification.created`.
 *   - ConversationsModule → lifecycle transitions (close paths).
 *   - WebhooksModule (forwardRef) → MetaSenderService for WhatsApp fallback.
 *
 * The `OnModuleInit` hook registers the inactivity cron AFTER the DI
 * graph is fully assembled, so the job never races module bootstrap.
 */
@Module({
  imports: [
    RealtimeModule,
    ConversationsModule,
    forwardRef(() => WebhooksModule),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EmailService,
    WhatsappNotificationAdapter,
    InactivityCloseJob,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(private readonly inactivity: InactivityCloseJob) {}

  onModuleInit(): void {
    this.inactivity.register();
  }
}
