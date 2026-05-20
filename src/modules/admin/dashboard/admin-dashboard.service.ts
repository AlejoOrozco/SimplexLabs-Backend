import { Injectable } from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  PaymentStatus,
  SubStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ESTIMATED_MRR_DISCLAIMER } from './admin-dashboard.constants';
import { decimalToNumber, effectiveMonthlyFromSubscriptionPricing, startOfMonth } from './admin-dashboard.util';

export interface DashboardStatsDto {
  readonly totalCompanies: number;
  readonly activeCompanies: number;
  readonly inactiveCompanies: number;
  readonly agentRevenueThisMonth: number;
  readonly estimatedMrr: number;
  readonly estimatedMrrDisclaimer: string;
  readonly agentFailuresThisMonth: number;
  readonly upcomingAdminAppointments: UpcomingAdminAppointmentDto[];
  readonly recentAgentFailures: RecentAgentFailureDto[];
}

export interface UpcomingAdminAppointmentDto {
  readonly id: string;
  readonly scheduledAt: string;
  readonly title: string;
  readonly status: AppointmentStatus;
  readonly durationMinutes: number;
  readonly companyName: string;
}

export interface RecentAgentFailureDto {
  readonly id: string;
  readonly createdAt: string;
  readonly conversationId: string;
  readonly companyName: string;
  readonly error: string | null;
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardStats(): Promise<DashboardStatsDto> {
    const monthStart = startOfMonth(new Date());
    const now = new Date();

    const [
      totalCompanies,
      activeCompanies,
      inactiveCompanies,
      agentRevenueAgg,
      activeSubscriptions,
      agentFailuresThisMonth,
      upcomingAdminAppointments,
      recentAgentRuns,
    ] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({
        where: { users: { some: { isActive: true } } },
      }),
      this.prisma.company.count({
        where: { users: { every: { isActive: false } } },
      }),
      this.prisma.payment.aggregate({
        where: {
          status: PaymentStatus.CONFIRMED,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.subscription.findMany({
        where: { status: SubStatus.ACTIVE },
        select: {
          billingCycle: true,
          plan: { select: { priceMonthly: true, priceAnnual: true } },
        },
      }),
      this.prisma.agentRun.count({
        where: {
          success: false,
          createdAt: { gte: monthStart },
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          type: AppointmentType.SIMPLEX_WITH_CLIENT,
          status: { not: AppointmentStatus.CANCELLED },
          scheduledAt: { gte: now },
        },
        select: {
          id: true,
          scheduledAt: true,
          title: true,
          status: true,
          durationMinutes: true,
          company: { select: { name: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 5,
      }),
      this.prisma.agentRun.findMany({
        where: { success: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          createdAt: true,
          error: true,
          conversation: {
            select: {
              id: true,
              company: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    const estimatedMrr = activeSubscriptions.reduce(
      (sum, sub) =>
        sum +
        effectiveMonthlyFromSubscriptionPricing({
          billingCycle: sub.billingCycle,
          priceMonthly: sub.plan.priceMonthly,
          priceAnnual: sub.plan.priceAnnual,
        }),
      0,
    );

    return {
      totalCompanies,
      activeCompanies,
      inactiveCompanies,
      agentRevenueThisMonth: decimalToNumber(agentRevenueAgg._sum.amount),
      estimatedMrr,
      estimatedMrrDisclaimer: ESTIMATED_MRR_DISCLAIMER,
      agentFailuresThisMonth,
      upcomingAdminAppointments: upcomingAdminAppointments.map((a) => ({
        id: a.id,
        scheduledAt: a.scheduledAt.toISOString(),
        title: a.title,
        status: a.status,
        durationMinutes: a.durationMinutes,
        companyName: a.company.name,
      })),
      recentAgentFailures: recentAgentRuns.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        conversationId: r.conversation.id,
        companyName: r.conversation.company.name,
        error: r.error,
      })),
    };
  }
}
