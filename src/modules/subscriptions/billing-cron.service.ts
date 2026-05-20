import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  BillingRecordStatus,
  NotificationType,
  SubStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class BillingCronService {
  private readonly logger = new Logger(BillingCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Daily 09:00 UTC — mark subscriptions past period end as overdue. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async markOverdueSubscriptions(): Promise<void> {
    this.logger.log('Running overdue subscription check…');

    const overdueNow = await this.prisma.subscription.findMany({
      where: {
        status: SubStatus.ACTIVE,
        currentPeriodEnd: { lt: new Date() },
        overdueSince: null,
        company: { is_platform_owner: false },
      },
      include: {
        company: { select: { id: true, name: true } },
        plan: { select: { name: true, category: true } },
      },
    });

    for (const sub of overdueNow) {
      try {
        const now = new Date();
        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { overdueSince: now },
        });

        await this.prisma.billingRecord.updateMany({
          where: {
            subscriptionId: sub.id,
            status: BillingRecordStatus.PENDING,
          },
          data: { status: BillingRecordStatus.OVERDUE },
        });

        await this.notifications.create({
          companyId: sub.companyId,
          type: NotificationType.AGENT_NEEDS_ATTENTION,
          title: 'Payment overdue',
          body: `${sub.company.name} — ${sub.plan.name} subscription is overdue`,
          payload: {
            kind: 'subscription_overdue',
            subscriptionId: sub.id,
            path: `/admin/companies/${sub.companyId}?tab=billing`,
          },
          deliverExternal: true,
        });

        this.logger.warn(
          `Subscription ${sub.id} marked overdue for ${sub.company.name}`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        this.logger.error(
          `Failed to mark subscription ${sub.id} overdue: ${message}`,
        );
      }
    }

    this.logger.log(
      `Overdue subscription check finished (${overdueNow.length} processed)`,
    );
  }
}
