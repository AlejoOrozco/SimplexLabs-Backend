import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendeesModule } from '../attendees/attendees.module';

@Module({
  imports: [
    WebhooksModule,
    RealtimeModule,
    ConversationsModule,
    NotificationsModule,
    AttendeesModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
