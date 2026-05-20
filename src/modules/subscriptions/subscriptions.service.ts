import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingCycle,
  BillingRecordStatus,
  NotificationType,
  PlanCategory,
  Prisma,
  SubStatus,
  SubscriptionUpgradeStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { planInclude } from '../plans/plan.mapper';
import {
  subscriptionDetailInclude,
  subscriptionListInclude,
  toSubscriptionResponseDto,
} from './subscription.mapper';
import type { SubscriptionDetailRow } from './subscription.mapper';
import type { SubscriptionResponseDto } from './dto/subscription-response.dto';
import type { BillingRecordWithRecorderResponseDto } from './dto/billing-record-response.dto';
import {
  AdminBillingOverviewResponseDto,
  AdminBillingSubscriptionDueDto,
  AdminBillingSubscriptionOverdueDto,
} from './dto/admin-billing-overview.response.dto';

const APPROX_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const APPROX_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateSubscriptionWithBillingInput {
  readonly companyId: string;
  readonly planId: string;
  readonly billingCycle: BillingCycle;
  readonly initialPayment: number;
  readonly startedAt: string;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(user: AuthenticatedUser): Promise<SubscriptionResponseDto[]> {
    const where =
      user.roleName === 'SUPER_ADMIN'
        ? {}
        : (() => {
            if (!user.companyId) {
              throw new ForbiddenException('Requester has no company scope');
            }
            return { companyId: user.companyId };
          })();

    const rows = await this.prisma.subscription.findMany({
      where,
      include: subscriptionListInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSubscriptionResponseDto);
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto> {
    const sub = await this.loadSubscriptionDetailOrThrow(id, user);
    return toSubscriptionResponseDto(sub);
  }

  async getBillingHistory(
    subscriptionId: string,
    user: AuthenticatedUser,
  ): Promise<BillingRecordWithRecorderResponseDto[]> {
    await this.loadSubscriptionDetailOrThrow(subscriptionId, user);
    const rows = await this.prisma.billingRecord.findMany({
      where: { subscriptionId },
      include: {
        recordedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      amount: r.amount.toString(),
      status: r.status,
      isSetupFee: r.isSetupFee,
      paidAt: r.paidAt,
      createdAt: r.createdAt,
      recordedBy: r.recordedBy
        ? {
            id: r.recordedBy.id,
            firstName: r.recordedBy.firstName,
            lastName: r.recordedBy.lastName,
          }
        : null,
    }));
  }

  async create(
    dto: CreateSubscriptionWithBillingInput,
    requesterId: string,
  ): Promise<SubscriptionResponseDto> {
    await this.assertCompanyExists(dto.companyId);
    const plan = await this.loadPlanForNewSubscription(dto.planId);
    await this.assertNoActiveSubscriptionInCategory(
      this.prisma,
      dto.companyId,
      plan.category,
    );

    const startedAt = new Date(dto.startedAt);
    const periodEnd = this.computePeriodEnd(startedAt, dto.billingCycle);

    const created = await this.prisma.$transaction(async (tx) => {
      const { subscriptionId } = await this.insertSubscriptionWithSetupBilling(
        tx,
        {
          companyId: dto.companyId,
          planId: dto.planId,
          billingCycle: dto.billingCycle,
          category: plan.category,
          initialPayment: dto.initialPayment,
          startedAt,
          periodEnd,
          requesterId,
        },
      );
      return tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: subscriptionListInclude,
      });
    });

    return toSubscriptionResponseDto(created);
  }

  /**
   * Used by admin onboarding so subscription + setup billing row share the same outer transaction.
   */
  async createWithinTransaction(
    tx: Prisma.TransactionClient,
    dto: CreateSubscriptionWithBillingInput,
    requesterId: string,
  ): Promise<void> {
    const plan = await this.loadPlanForNewSubscription(dto.planId, tx);
    await this.assertNoActiveSubscriptionInCategory(
      tx,
      dto.companyId,
      plan.category,
    );
    const startedAt = new Date(dto.startedAt);
    const periodEnd = this.computePeriodEnd(startedAt, dto.billingCycle);
    await this.insertSubscriptionWithSetupBilling(tx, {
      companyId: dto.companyId,
      planId: dto.planId,
      billingCycle: dto.billingCycle,
      category: plan.category,
      initialPayment: dto.initialPayment,
      startedAt,
      periodEnd,
      requesterId,
    });
  }

  async scheduleUpgrade(
    subscriptionId: string,
    newPlanId: string,
    user: AuthenticatedUser,
  ): Promise<{
    scheduled: boolean;
    message: string;
    effectiveDate: Date | null;
  }> {
    const sub = await this.loadSubscriptionDetailOrThrow(subscriptionId, user);

    const newPlan = await this.prisma.plan.findUnique({
      where: { id: newPlanId },
      select: { id: true, category: true, tier: true, name: true },
    });
    if (!newPlan) {
      throw new NotFoundException('Plan not found');
    }
    if (newPlan.category !== sub.plan.category) {
      throw new BadRequestException(
        'Cannot upgrade to a plan in a different category',
      );
    }

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        pendingPlanId: newPlanId,
        upgradeStatus: SubscriptionUpgradeStatus.SCHEDULED,
      },
    });

    this.logger.log(
      `Upgrade scheduled for subscription ${subscriptionId} → plan ${newPlanId}`,
    );

    return {
      scheduled: true,
      message: `Upgrade to ${newPlan.name} will take effect on the next billing date`,
      effectiveDate: sub.currentPeriodEnd,
    };
  }

  async cancelUpgrade(
    subscriptionId: string,
    user: AuthenticatedUser,
  ): Promise<{ cancelled: boolean }> {
    await this.loadSubscriptionDetailOrThrow(subscriptionId, user);
    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        pendingPlanId: null,
        upgradeStatus: SubscriptionUpgradeStatus.NONE,
      },
    });
    return { cancelled: true };
  }

  async recordPayment(
    dto: {
      subscriptionId: string;
      billingRecordId?: string;
      amount?: number;
      paidAt: string;
      paymentMethod: string;
      notes?: string;
    },
    requesterId: string,
    user: AuthenticatedUser,
  ): Promise<{ recorded: boolean; nextBillingDate: Date }> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: dto.subscriptionId },
      include: { plan: { include: planInclude } },
    });
    if (!sub) {
      throw new NotFoundException('Subscription not found');
    }
    this.assertCompanyScope(user, sub.companyId);

    const paidAt = new Date(dto.paidAt);
    const next = await this.prisma.$transaction(async (tx) => {
      let billingRecordId = dto.billingRecordId;

      if (!billingRecordId) {
        const baseAmount =
          sub.billingCycle === BillingCycle.MONTHLY
            ? sub.plan.priceMonthly
            : sub.plan.priceAnnual ?? sub.plan.priceMonthly;
        if (
          sub.billingCycle === BillingCycle.ANNUAL &&
          !sub.plan.priceAnnual &&
          dto.amount === undefined
        ) {
          throw new BadRequestException(
            'Annual plan has no annual price; pass amount explicitly',
          );
        }
        const amountDec =
          dto.amount !== undefined
            ? new Prisma.Decimal(dto.amount)
            : new Prisma.Decimal(baseAmount);
        const periodStart = sub.currentPeriodEnd ?? new Date();
        const periodEnd = this.computePeriodEnd(periodStart, sub.billingCycle);
        const record = await tx.billingRecord.create({
          data: {
            companyId: sub.companyId,
            subscriptionId: sub.id,
            amount: amountDec,
            isSetupFee: false,
            billingCycle: sub.billingCycle,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            status: BillingRecordStatus.PAID,
            paymentMethod: dto.paymentMethod,
            paidAt,
            recordedById: requesterId,
            notes: dto.notes,
          },
        });
        billingRecordId = record.id;
      } else {
        const owned = await tx.billingRecord.findFirst({
          where: { id: dto.billingRecordId, subscriptionId: sub.id },
          select: { id: true },
        });
        if (!owned) {
          throw new BadRequestException(
            'Billing record not found for this subscription',
          );
        }
        await tx.billingRecord.update({
          where: { id: owned.id },
          data: {
            status: BillingRecordStatus.PAID,
            paidAt,
            paymentMethod: dto.paymentMethod,
            recordedById: requesterId,
            notes: dto.notes,
          },
        });
      }

      const newPeriodStart = sub.currentPeriodEnd ?? new Date();
      const newPeriodEnd = this.computePeriodEnd(
        newPeriodStart,
        sub.billingCycle,
      );

      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: SubStatus.ACTIVE,
          overdueSince: null,
          currentPeriodStart: newPeriodStart,
          currentPeriodEnd: newPeriodEnd,
          nextBillingAt: newPeriodEnd,
          planId: sub.pendingPlanId ?? sub.planId,
          pendingPlanId: null,
          upgradeStatus: SubscriptionUpgradeStatus.NONE,
        },
      });

      return newPeriodEnd;
    });

    return { recorded: true, nextBillingDate: next };
  }

  async cancel(
    subscriptionId: string,
    reason: string,
    user: AuthenticatedUser,
  ): Promise<{ cancelled: boolean }> {
    const sub = await this.loadSubscriptionDetailOrThrow(subscriptionId, user);

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: SubStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    await this.notifications.create({
      companyId: sub.companyId,
      type: NotificationType.AGENT_NEEDS_ATTENTION,
      title: 'Subscription cancelled',
      body: `Your ${sub.plan.category ?? 'subscription'} subscription has been cancelled.`,
      payload: {
        subscriptionId: sub.id,
        path: '/dashboard/billing',
      },
      deliverExternal: true,
    });

    return { cancelled: true };
  }

  async getAdminBillingOverview(): Promise<AdminBillingOverviewResponseDto> {
    const now = new Date();
    const weekAhead = new Date(Date.now() + SEVEN_DAYS_MS);

    const [dueSoonRows, overdueRows, allActive] = await Promise.all([
      this.prisma.subscription.findMany({
        where: {
          status: SubStatus.ACTIVE,
          currentPeriodEnd: { gte: now, lte: weekAhead },
          company: { is_platform_owner: false },
        },
        include: {
          company: { select: { id: true, name: true } },
          plan: {
            select: {
              name: true,
              category: true,
              priceMonthly: true,
              priceAnnual: true,
            },
          },
        },
        orderBy: { currentPeriodEnd: 'asc' },
      }),
      this.prisma.subscription.findMany({
        where: {
          status: SubStatus.ACTIVE,
          overdueSince: { not: null },
          company: { is_platform_owner: false },
        },
        include: {
          company: { select: { id: true, name: true } },
          plan: {
            select: {
              name: true,
              category: true,
              priceMonthly: true,
              priceAnnual: true,
            },
          },
        },
        orderBy: { overdueSince: 'asc' },
      }),
      this.prisma.subscription.findMany({
        where: {
          status: SubStatus.ACTIVE,
          company: { is_platform_owner: false },
        },
        include: {
          plan: { select: { priceMonthly: true, priceAnnual: true } },
        },
      }),
    ]);

    const totalMrr = allActive.reduce((sum, s) => {
      const monthly =
        s.billingCycle === BillingCycle.MONTHLY
          ? Number(s.plan.priceMonthly)
          : s.plan.priceAnnual
            ? Number(s.plan.priceAnnual) / 12
            : Number(s.plan.priceMonthly);
      return sum + monthly;
    }, 0);

    const dueSoon: AdminBillingSubscriptionDueDto[] = dueSoonRows.map((s) => ({
      id: s.id,
      companyId: s.companyId,
      billingCycle: s.billingCycle,
      currentPeriodEnd: s.currentPeriodEnd,
      company: { id: s.company.id, name: s.company.name },
      plan: {
        name: s.plan.name,
        category: s.plan.category,
        priceMonthly: s.plan.priceMonthly.toString(),
        priceAnnual: s.plan.priceAnnual
          ? s.plan.priceAnnual.toString()
          : null,
      },
    }));

    const overdue: AdminBillingSubscriptionOverdueDto[] = overdueRows.map(
      (s) => ({
        id: s.id,
        companyId: s.companyId,
        billingCycle: s.billingCycle,
        overdueSince: s.overdueSince,
        company: { id: s.company.id, name: s.company.name },
        plan: {
          name: s.plan.name,
          category: s.plan.category,
          priceMonthly: s.plan.priceMonthly.toString(),
          priceAnnual: s.plan.priceAnnual
            ? s.plan.priceAnnual.toString()
            : null,
        },
      }),
    );

    return {
      totalMrr,
      activeSubscriptions: allActive.length,
      dueSoon,
      overdue,
    };
  }

  private computePeriodEnd(startedAt: Date, billingCycle: BillingCycle): Date {
    return billingCycle === BillingCycle.MONTHLY
      ? new Date(startedAt.getTime() + APPROX_MONTH_MS)
      : new Date(startedAt.getTime() + APPROX_YEAR_MS);
  }

  private async insertSubscriptionWithSetupBilling(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      planId: string;
      billingCycle: BillingCycle;
      category: PlanCategory;
      initialPayment: number;
      startedAt: Date;
      periodEnd: Date;
      requesterId: string;
    },
  ): Promise<{ subscriptionId: string }> {
    const subscription = await tx.subscription.create({
      data: {
        companyId: input.companyId,
        planId: input.planId,
        category: input.category,
        billingCycle: input.billingCycle,
        status: SubStatus.ACTIVE,
        initialPayment: new Prisma.Decimal(input.initialPayment),
        startedAt: input.startedAt,
        currentPeriodStart: input.startedAt,
        currentPeriodEnd: input.periodEnd,
        nextBillingAt: input.periodEnd,
      },
    });

    await tx.billingRecord.create({
      data: {
        companyId: input.companyId,
        subscriptionId: subscription.id,
        amount: new Prisma.Decimal(input.initialPayment),
        isSetupFee: true,
        billingCycle: input.billingCycle,
        billingPeriodStart: input.startedAt,
        billingPeriodEnd: input.periodEnd,
        status: BillingRecordStatus.PAID,
        paidAt: input.startedAt,
        recordedById: input.requesterId,
        notes: 'Initial setup payment recorded during onboarding',
      },
    });

    return { subscriptionId: subscription.id };
  }

  private async loadPlanForNewSubscription(
    planId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{
    category: PlanCategory;
    priceMonthly: Prisma.Decimal;
    priceAnnual: Prisma.Decimal | null;
    setupFee: Prisma.Decimal;
  }> {
    const plan = await client.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        category: true,
        isActive: true,
        priceMonthly: true,
        priceAnnual: true,
        setupFee: true,
      },
    });
    if (!plan || !plan.isActive || !plan.category) {
      throw new BadRequestException('Invalid plan');
    }
    return {
      category: plan.category,
      priceMonthly: plan.priceMonthly,
      priceAnnual: plan.priceAnnual,
      setupFee: plan.setupFee,
    };
  }

  private async assertNoActiveSubscriptionInCategory(
    client: Prisma.TransactionClient | PrismaService,
    companyId: string,
    category: PlanCategory,
  ): Promise<void> {
    const existing = await client.subscription.findFirst({
      where: {
        companyId,
        category,
        status: { in: [SubStatus.ACTIVE, SubStatus.PAUSED] },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        `This company already has an active ${category} subscription. Cancel or upgrade the existing one first.`,
      );
    }
  }

  private async loadSubscriptionDetailOrThrow(
    id: string,
    user: AuthenticatedUser,
  ): Promise<SubscriptionDetailRow> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: subscriptionDetailInclude,
    });
    if (!sub) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }
    this.assertCompanyScope(user, sub.companyId);
    return sub;
  }

  private assertCompanyScope(
    user: AuthenticatedUser,
    companyId: string,
  ): void {
    if (user.roleName === 'SUPER_ADMIN') return;
    if (!user.companyId || user.companyId !== companyId) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async assertCompanyExists(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }
  }
}
