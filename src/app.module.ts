import {
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configuration } from './config/configuration';
import { CommonModule } from './common/common.module';
import { ReliabilityModule } from './common/reliability/reliability.module';
import { CorrelationIdMiddleware } from './common/observability/correlation-id.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { PlansModule } from './modules/plans/plans.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { ClientContactsModule } from './modules/client-contacts/client-contacts.module';
import { WebsitesModule } from './modules/websites/websites.module';
import { ProductsModule } from './modules/products/products.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { AgentsModule } from './modules/agents/agents.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { StaffModule } from './modules/staff/staff.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    // Default envelope: 100 req/min per IP. Webhook routes opt-out
    // explicitly via @SkipThrottle() on the controller (Meta/Stripe
    // may burst well above this during provider retries).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
    CommonModule,
    ReliabilityModule,
    PrismaModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    PlansModule,
    SubscriptionsModule,
    ClientContactsModule,
    WebsitesModule,
    ProductsModule,
    OrdersModule,
    AppointmentsModule,
    RealtimeModule,
    ConversationsModule,
    ChannelsModule,
    StaffModule,
    SchedulingModule,
    PaymentsModule,
    NotificationsModule,
    AgentsModule,
    WebhooksModule,
    AdminModule,
  ],
  providers: [
    {
      // Wires the rate limiter app-wide. Controllers opt out via
      // @SkipThrottle() and override budgets via @Throttle(...).
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
