import { ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { scopedCompanyWhere } from '../../common/tenant/tenant-scope';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isTenantUser } from '../../common/auth/user-role.util';
import type { CompanyDashboardStatsDto } from './dto/company-dashboard-stats.dto';

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

@Injectable()
export class CompanyDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getCompanyStats(
    requester: AuthenticatedUser,
  ): Promise<CompanyDashboardStatsDto> {
    if (!isTenantUser(requester)) {
      throw new ForbiddenException(
        'Company dashboard stats require a tenant-scoped user',
      );
    }

    const scope = scopedCompanyWhere(requester);
    const monthStart = startOfMonth(new Date());

    const [
      ordersCount,
      conversationsCount,
      usersCount,
      productsCount,
      revenueAgg,
      unreadNotificationsCount,
    ] = await Promise.all([
      this.prisma.order.count({ where: scope }),
      this.prisma.conversation.count({ where: scope }),
      this.prisma.user.count({
        where: { ...scope, isActive: true },
      }),
      this.prisma.product.count({ where: { ...scope, isActive: true } }),
      this.prisma.payment.aggregate({
        where: {
          ...scope,
          status: PaymentStatus.CONFIRMED,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.notification.count({
        where: { ...scope, readAt: null },
      }),
    ]);

    return {
      ordersCount,
      conversationsCount,
      usersCount,
      productsCount,
      revenueThisMonth: Number(revenueAgg._sum.amount ?? 0),
      unreadNotificationsCount,
    };
  }
}
