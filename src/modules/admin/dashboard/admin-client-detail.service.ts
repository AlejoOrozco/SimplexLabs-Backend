import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ConvoStatus,
  OrderStatus,
  PaymentStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { decimalToNumber, startOfMonth } from './admin-dashboard.util';
import {
  companyDetailInclude,
  mapAgentRunRow,
  mapAppointmentRow,
  mapCompanyDetail,
  mapConversationRow,
  mapOrderRow,
} from './admin-client-detail.mapper';

export interface ClientDetailStatsDto {
  readonly agentRunCount: number;
  readonly avgResponseMs: number;
  readonly avgTokensPerRun: number;
  readonly revenueThisMonth: number;
  readonly openConversations: number;
  readonly pendingOrders: number;
}

export interface ClientDetailResponseDto {
  readonly company: ReturnType<typeof mapCompanyDetail>;
  readonly stats: ClientDetailStatsDto;
  readonly conversations: ReturnType<typeof mapConversationRow>[];
  readonly orders: ReturnType<typeof mapOrderRow>[];
  readonly appointments: ReturnType<typeof mapAppointmentRow>[];
  readonly recentAgentRuns: ReturnType<typeof mapAgentRunRow>[];
}

@Injectable()
export class AdminClientDetailService {
  constructor(private readonly prisma: PrismaService) {}

  async getClientDetail(companyId: string): Promise<ClientDetailResponseDto> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: companyDetailInclude,
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }

    const monthStart = startOfMonth(new Date());
    const convoOpenWhere = {
      companyId,
      status: { not: ConvoStatus.CLOSED },
    };

    const [
      agentRunCount,
      agentAvgs,
      revenueAgg,
      openConversations,
      pendingOrders,
      conversations,
      orders,
      appointments,
      recentAgentRuns,
    ] = await Promise.all([
      this.prisma.agentRun.count({
        where: { conversation: { companyId } },
      }),
      this.prisma.agentRun.aggregate({
        where: { conversation: { companyId } },
        _avg: { durationMs: true, totalTokens: true },
      }),
      this.prisma.payment.aggregate({
        where: {
          companyId,
          status: PaymentStatus.CONFIRMED,
          createdAt: { gte: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.conversation.count({ where: convoOpenWhere }),
      this.prisma.order.count({
        where: {
          companyId,
          status: { in: [OrderStatus.PENDING, OrderStatus.CONFIRMED] },
        },
      }),
      this.prisma.conversation.findMany({
        where: { companyId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          channel: true,
          status: true,
          lifecycleStatus: true,
          controlMode: true,
          createdAt: true,
          updatedAt: true,
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              source: true,
            },
          },
        },
      }),
      this.prisma.order.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          id: true,
          status: true,
          amount: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          product: {
            select: { id: true, name: true, type: true },
          },
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.appointment.findMany({
        where: { companyId },
        orderBy: { scheduledAt: 'desc' },
        take: 30,
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          scheduledAt: true,
          durationMinutes: true,
          meetingUrl: true,
          callMeAsap: true,
          organizer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          contact: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.agentRun.findMany({
        where: { conversation: { companyId } },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          createdAt: true,
          success: true,
          durationMs: true,
          totalTokens: true,
          error: true,
          conversationId: true,
        },
      }),
    ]);

    const stats: ClientDetailStatsDto = {
      agentRunCount,
      avgResponseMs: Math.round(agentAvgs._avg.durationMs ?? 0),
      avgTokensPerRun: Math.round(agentAvgs._avg.totalTokens ?? 0),
      revenueThisMonth: decimalToNumber(revenueAgg._sum.amount),
      openConversations,
      pendingOrders,
    };

    return {
      company: mapCompanyDetail(company),
      stats,
      conversations: conversations.map(mapConversationRow),
      orders: orders.map(mapOrderRow),
      appointments: appointments.map(mapAppointmentRow),
      recentAgentRuns: recentAgentRuns.map(mapAgentRunRow),
    };
  }
}
