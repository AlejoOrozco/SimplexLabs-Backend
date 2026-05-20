import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingCronService } from './billing-cron.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, BillingCronService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
