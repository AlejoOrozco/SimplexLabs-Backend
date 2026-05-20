import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AttendeesService } from './attendees.service';

@Module({
  imports: [NotificationsModule],
  providers: [AttendeesService],
  exports: [AttendeesService],
})
export class AttendeesModule {}
