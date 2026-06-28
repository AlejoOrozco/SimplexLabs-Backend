import { Injectable, NotFoundException } from '@nestjs/common';
import { PlanCategory, SubStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { decimalToNumber, toIso } from './admin-dashboard.util';
import { companyDetailInclude } from './admin-client-detail.mapper';

export interface ManageSummaryUserDto {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roleName: string;
  readonly isActive: boolean;
}

export interface ManageSummaryResponseDto {
  readonly company: {
    readonly id: string;
    readonly name: string;
    readonly niche: string;
    readonly phone: string | null;
    readonly address: string | null;
    readonly isActive: boolean;
    readonly isPlatformOwner: boolean;
    readonly createdAt: string;
    readonly notificationEmail: string | null;
    readonly notificationPhone: string | null;
  };
  readonly subscriptions: Array<{
    readonly id: string;
    readonly status: string;
    readonly category: string | null;
    readonly billingCycle: string;
    readonly startedAt: string;
    readonly nextBillingAt: string | null;
    readonly plan: {
      readonly id: string;
      readonly name: string;
      readonly category: string | null;
      readonly tier: string | null;
      readonly priceMonthly: number;
      readonly priceAnnual: number | null;
    };
  }>;
  readonly websites: {
    readonly count: number;
    readonly items: Array<{
      readonly id: string;
      readonly url: string;
      readonly label: string | null;
      readonly isActive: boolean;
    }>;
  };
  readonly users: {
    readonly count: number;
    readonly primaryAdmin: ManageSummaryUserDto | null;
    readonly items: ManageSummaryUserDto[];
  };
  readonly agentConfig: {
    readonly id: string;
    readonly name: string;
    readonly channels: string[];
    readonly fallbackMessage: string;
    readonly escalationMessage: string;
    readonly isActive: boolean;
  } | null;
  readonly knowledgeBase: {
    readonly entryCount: number;
    readonly activeCount: number;
  };
  readonly setupGaps: string[];
}

const SETUP_GAP = {
  NO_WEBSITE_PLAN: 'NO_WEBSITE_PLAN',
  NO_MARKETING_PLAN: 'NO_MARKETING_PLAN',
  NO_AGENTS_PLAN: 'NO_AGENTS_PLAN',
  NO_PRIMARY_USER: 'NO_PRIMARY_USER',
  NO_WEBSITE: 'NO_WEBSITE',
  NO_AGENT_CONFIG: 'NO_AGENT_CONFIG',
} as const;

@Injectable()
export class AdminManageSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getManageSummary(companyId: string): Promise<ManageSummaryResponseDto> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        ...companyDetailInclude,
        websites: { orderBy: { createdAt: 'desc' } },
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role_name: true,
            isActive: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        agentConfigs: {
          where: { isActive: true },
          take: 1,
          orderBy: { createdAt: 'asc' },
        },
        settings: true,
      },
    });

    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }

    const [kbTotal, kbActive] = await Promise.all([
      this.prisma.agentKnowledgeBase.count({ where: { companyId } }),
      this.prisma.agentKnowledgeBase.count({
        where: { companyId, isActive: true },
      }),
    ]);

    const activeSubscriptions = company.subscriptions.filter(
      (s) => s.status === SubStatus.ACTIVE || s.status === SubStatus.PAUSED,
    );

    const primaryAdmin =
      company.users.find((u) => u.role_name === 'COMPANY_ADMIN') ??
      company.users.find((u) => u.role_name === 'CLIENT') ??
      null;

    const activeAgentConfig = company.agentConfigs[0] ?? null;

    const setupGaps = this.computeSetupGaps({
      activeSubscriptions,
      primaryAdmin,
      websiteCount: company.websites.length,
      hasAgentConfig: activeAgentConfig !== null,
    });

    return {
      company: {
        id: company.id,
        name: company.name,
        niche: company.niche,
        phone: company.phone,
        address: company.address,
        isActive: company.isActive,
        isPlatformOwner: company.is_platform_owner,
        createdAt: toIso(company.createdAt),
        notificationEmail: company.settings?.notificationEmail ?? null,
        notificationPhone: company.settings?.notificationWhatsapp ?? null,
      },
      subscriptions: company.subscriptions.map((s) => ({
        id: s.id,
        status: s.status,
        category: s.category,
        billingCycle: s.billingCycle,
        startedAt: toIso(s.startedAt),
        nextBillingAt: s.nextBillingAt ? toIso(s.nextBillingAt) : null,
        plan: {
          id: s.plan.id,
          name: s.plan.name,
          category: s.plan.category,
          tier: s.plan.tier,
          priceMonthly: decimalToNumber(s.plan.priceMonthly),
          priceAnnual: s.plan.priceAnnual
            ? decimalToNumber(s.plan.priceAnnual)
            : null,
        },
      })),
      websites: {
        count: company.websites.length,
        items: company.websites.map((w) => ({
          id: w.id,
          url: w.url,
          label: w.label,
          isActive: w.isActive,
        })),
      },
      users: {
        count: company.users.length,
        primaryAdmin: primaryAdmin
          ? {
              id: primaryAdmin.id,
              email: primaryAdmin.email,
              firstName: primaryAdmin.firstName,
              lastName: primaryAdmin.lastName,
              roleName: primaryAdmin.role_name,
              isActive: primaryAdmin.isActive,
            }
          : null,
        items: company.users.map((u) => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          roleName: u.role_name,
          isActive: u.isActive,
        })),
      },
      agentConfig: activeAgentConfig
        ? {
            id: activeAgentConfig.id,
            name: activeAgentConfig.name,
            channels: activeAgentConfig.channels,
            fallbackMessage: activeAgentConfig.fallbackMessage,
            escalationMessage: activeAgentConfig.escalationMessage,
            isActive: activeAgentConfig.isActive,
          }
        : null,
      knowledgeBase: {
        entryCount: kbTotal,
        activeCount: kbActive,
      },
      setupGaps,
    };
  }

  private computeSetupGaps(input: {
    activeSubscriptions: Array<{ category: PlanCategory | null }>;
    primaryAdmin: { id: string } | null;
    websiteCount: number;
    hasAgentConfig: boolean;
  }): string[] {
    const gaps: string[] = [];
    const categories = new Set(
      input.activeSubscriptions
        .map((s) => s.category)
        .filter((c): c is PlanCategory => c !== null),
    );

    if (!categories.has(PlanCategory.WEBSITE)) {
      gaps.push(SETUP_GAP.NO_WEBSITE_PLAN);
    }
    if (!categories.has(PlanCategory.MARKETING)) {
      gaps.push(SETUP_GAP.NO_MARKETING_PLAN);
    }
    if (!categories.has(PlanCategory.AI_AGENTS)) {
      gaps.push(SETUP_GAP.NO_AGENTS_PLAN);
    }
    if (!input.primaryAdmin) {
      gaps.push(SETUP_GAP.NO_PRIMARY_USER);
    }
    if (input.websiteCount === 0) {
      gaps.push(SETUP_GAP.NO_WEBSITE);
    }
    if (!input.hasAgentConfig) {
      gaps.push(SETUP_GAP.NO_AGENT_CONFIG);
    }
    return gaps;
  }
}
