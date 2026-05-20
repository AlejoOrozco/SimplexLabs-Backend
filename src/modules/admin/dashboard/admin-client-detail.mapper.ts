import { Prisma } from '@prisma/client';
import { decimalToNumber, toIso } from './admin-dashboard.util';

export const companyDetailInclude = {
  subscriptions: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
    include: {
      plan: {
        include: {
          includedFeatures: true,
          planChannels: true,
        },
      },
    },
  },
  users: {
    where: { role_name: 'CLIENT' },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      firstLoginCompleted: true,
      credentialsSentAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  websites: {
    orderBy: { createdAt: 'desc' as const },
    take: 50,
  },
  agentConfigs: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      prompts: { orderBy: { role: 'asc' as const } },
    },
  },
  settings: true,
} satisfies Prisma.CompanyInclude;

export type CompanyDetailRow = Prisma.CompanyGetPayload<{
  include: typeof companyDetailInclude;
}>;

export function mapCompanyDetail(row: CompanyDetailRow) {
  return {
    id: row.id,
    name: row.name,
    niche: row.niche,
    phone: row.phone,
    address: row.address,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    deactivatedAt: row.deactivatedAt ? toIso(row.deactivatedAt) : null,
    deactivationReason: row.deactivationReason,
    firstLoginCompleted: row.firstLoginCompleted,
    subscriptions: row.subscriptions.map((s) => ({
      id: s.id,
      status: s.status,
      category: s.category,
      billingCycle: s.billingCycle,
      currentPeriodStart: s.currentPeriodStart
        ? toIso(s.currentPeriodStart)
        : null,
      currentPeriodEnd: s.currentPeriodEnd ? toIso(s.currentPeriodEnd) : null,
      overdueSince: s.overdueSince ? toIso(s.overdueSince) : null,
      gracePeriodDays: s.gracePeriodDays,
      pendingPlanId: s.pendingPlanId,
      upgradeStatus: s.upgradeStatus,
      cancelledAt: s.cancelledAt ? toIso(s.cancelledAt) : null,
      cancellationReason: s.cancellationReason,
      startedAt: toIso(s.startedAt),
      nextBillingAt: s.nextBillingAt ? toIso(s.nextBillingAt) : null,
      initialPayment: decimalToNumber(s.initialPayment),
      createdAt: toIso(s.createdAt),
      plan: {
        id: s.plan.id,
        name: s.plan.name,
        niche: s.plan.niche,
        category: s.plan.category,
        tier: s.plan.tier,
        priceMonthly: decimalToNumber(s.plan.priceMonthly),
        priceAnnual: s.plan.priceAnnual
          ? decimalToNumber(s.plan.priceAnnual)
          : null,
        setupFee: decimalToNumber(s.plan.setupFee),
        maxCampaigns: s.plan.maxCampaigns,
        description: s.plan.description,
        isActive: s.plan.isActive,
        features: s.plan.includedFeatures.map((f) => ({
          id: f.id,
          feature: f.feature,
        })),
        channels: s.plan.planChannels.map((c) => ({
          id: c.id,
          channel: c.channel,
        })),
      },
    })),
    users: row.users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      isActive: u.isActive,
      createdAt: toIso(u.createdAt),
      updatedAt: toIso(u.updatedAt),
      firstLoginCompleted: u.firstLoginCompleted,
      credentialsSentAt: u.credentialsSentAt
        ? toIso(u.credentialsSentAt)
        : null,
    })),
    websites: row.websites.map((w) => ({
      id: w.id,
      url: w.url,
      label: w.label,
      isActive: w.isActive,
      createdAt: toIso(w.createdAt),
    })),
    agentConfigs: row.agentConfigs.map((cfg) => ({
      id: cfg.id,
      name: cfg.name,
      isActive: cfg.isActive,
      channels: cfg.channels,
      language: cfg.language,
      fallbackMessage: cfg.fallbackMessage,
      escalationMessage: cfg.escalationMessage,
      createdAt: toIso(cfg.createdAt),
      updatedAt: toIso(cfg.updatedAt),
      prompts: cfg.prompts.map((p) => ({
        id: p.id,
        role: p.role,
        systemPrompt: p.systemPrompt,
        model: p.model,
        temperature: p.temperature,
        maxTokens: p.maxTokens,
        isActive: p.isActive,
      })),
    })),
    settings: row.settings
      ? {
          id: row.settings.id,
          timezone: row.settings.timezone,
          defaultSlotDurationMinutes: row.settings.defaultSlotDurationMinutes,
          inactivityCloseHours: row.settings.inactivityCloseHours,
          stripeEnabled: row.settings.stripeEnabled,
          wireTransferEnabled: row.settings.wireTransferEnabled,
          wireTransferInstructions: row.settings.wireTransferInstructions,
          notificationEmail: row.settings.notificationEmail,
          notificationWhatsapp: row.settings.notificationWhatsapp,
          inAppNotificationsEnabled: row.settings.inAppNotificationsEnabled,
        }
      : null,
  };
}

export function mapConversationRow(
  c: Prisma.ConversationGetPayload<{
    select: {
      id: true;
      channel: true;
      status: true;
      lifecycleStatus: true;
      controlMode: true;
      createdAt: true;
      updatedAt: true;
      contact: {
        select: {
          id: true;
          firstName: true;
          lastName: true;
          phone: true;
          source: true;
        };
      };
    };
  }>,
) {
  return {
    id: c.id,
    channel: c.channel,
    status: c.status,
    lifecycleStatus: c.lifecycleStatus,
    controlMode: c.controlMode,
    createdAt: toIso(c.createdAt),
    updatedAt: toIso(c.updatedAt),
    contact: {
      id: c.contact.id,
      firstName: c.contact.firstName,
      lastName: c.contact.lastName,
      phone: c.contact.phone,
      source: c.contact.source,
    },
  };
}

export function mapOrderRow(
  o: Prisma.OrderGetPayload<{
    select: {
      id: true;
      status: true;
      amount: true;
      notes: true;
      createdAt: true;
      updatedAt: true;
      product: { select: { id: true; name: true; type: true } };
      contact: {
        select: {
          id: true;
          firstName: true;
          lastName: true;
          phone: true;
        };
      };
    };
  }>,
) {
  return {
    id: o.id,
    status: o.status,
    amount: decimalToNumber(o.amount),
    notes: o.notes,
    createdAt: toIso(o.createdAt),
    updatedAt: toIso(o.updatedAt),
    product: {
      id: o.product.id,
      name: o.product.name,
      type: o.product.type,
    },
    contact: {
      id: o.contact.id,
      firstName: o.contact.firstName,
      lastName: o.contact.lastName,
      phone: o.contact.phone,
    },
  };
}

export function mapAppointmentRow(
  a: Prisma.AppointmentGetPayload<{
    select: {
      id: true;
      title: true;
      type: true;
      status: true;
      scheduledAt: true;
      durationMinutes: true;
      meetingUrl: true;
      callMeAsap: true;
      organizer: {
        select: { id: true; firstName: true; lastName: true; email: true };
      };
      contact: {
        select: { id: true; firstName: true; lastName: true };
      };
    };
  }>,
) {
  return {
    id: a.id,
    title: a.title,
    type: a.type,
    status: a.status,
    scheduledAt: toIso(a.scheduledAt),
    durationMinutes: a.durationMinutes,
    meetingUrl: a.meetingUrl,
    callMeAsap: a.callMeAsap,
    organizer: {
      id: a.organizer.id,
      firstName: a.organizer.firstName,
      lastName: a.organizer.lastName,
      email: a.organizer.email,
    },
    contact: a.contact
      ? {
          id: a.contact.id,
          firstName: a.contact.firstName,
          lastName: a.contact.lastName,
        }
      : null,
  };
}

export function mapAgentRunRow(r: {
  id: string;
  createdAt: Date;
  success: boolean;
  durationMs: number;
  totalTokens: number;
  error: string | null;
  conversationId: string;
}) {
  return {
    id: r.id,
    createdAt: toIso(r.createdAt),
    success: r.success,
    durationMs: r.durationMs,
    totalTokens: r.totalTokens,
    error: r.error,
    conversationId: r.conversationId,
  };
}
