import { Prisma } from '@prisma/client';
import { planInclude, toPlanResponse } from '../plans/plan.mapper';
import type { BillingRecordResponseDto } from './dto/billing-record-response.dto';
import type { PendingPlanSummaryDto } from './dto/pending-plan-summary.dto';
import type { SubscriptionResponseDto } from './dto/subscription-response.dto';

const billingRecordSelect = {
  id: true,
  amount: true,
  status: true,
  isSetupFee: true,
  paidAt: true,
  createdAt: true,
} satisfies Prisma.BillingRecordSelect;

export const subscriptionListInclude = {
  plan: { include: planInclude },
  pendingPlan: {
    select: {
      id: true,
      name: true,
      tier: true,
      category: true,
      priceMonthly: true,
      priceAnnual: true,
    },
  },
  billingRecords: {
    orderBy: { createdAt: 'desc' as const },
    take: 3,
    select: billingRecordSelect,
  },
} satisfies Prisma.SubscriptionInclude;

export const subscriptionDetailInclude = {
  plan: { include: planInclude },
  pendingPlan: {
    select: {
      id: true,
      name: true,
      tier: true,
      category: true,
      priceMonthly: true,
      priceAnnual: true,
    },
  },
  billingRecords: {
    orderBy: { createdAt: 'desc' as const },
    take: 50,
    select: billingRecordSelect,
  },
} satisfies Prisma.SubscriptionInclude;

export type SubscriptionListRow = Prisma.SubscriptionGetPayload<{
  include: typeof subscriptionListInclude;
}>;

export type SubscriptionDetailRow = Prisma.SubscriptionGetPayload<{
  include: typeof subscriptionDetailInclude;
}>;

function toPendingPlanSummary(
  plan: SubscriptionListRow['pendingPlan'],
): PendingPlanSummaryDto | null {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    tier: plan.tier ?? null,
    category: plan.category ?? null,
    priceMonthly: plan.priceMonthly.toString(),
    priceAnnual: plan.priceAnnual ? plan.priceAnnual.toString() : null,
  };
}

function toBillingRecordSummaries(
  rows: SubscriptionListRow['billingRecords'],
): BillingRecordResponseDto[] {
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount.toString(),
    status: r.status,
    isSetupFee: r.isSetupFee,
    paidAt: r.paidAt,
    createdAt: r.createdAt,
  }));
}

export function toSubscriptionResponseDto(
  sub: SubscriptionListRow | SubscriptionDetailRow,
): SubscriptionResponseDto {
  return {
    id: sub.id,
    companyId: sub.companyId,
    planId: sub.planId,
    status: sub.status,
    category: sub.category ?? null,
    billingCycle: sub.billingCycle,
    currentPeriodStart: sub.currentPeriodStart ?? null,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    overdueSince: sub.overdueSince ?? null,
    gracePeriodDays: sub.gracePeriodDays,
    pendingPlanId: sub.pendingPlanId ?? null,
    upgradeStatus: sub.upgradeStatus,
    cancelledAt: sub.cancelledAt ?? null,
    cancellationReason: sub.cancellationReason ?? null,
    initialPayment: sub.initialPayment.toString(),
    startedAt: sub.startedAt,
    nextBillingAt: sub.nextBillingAt,
    plan: toPlanResponse(sub.plan),
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
    pendingPlan: toPendingPlanSummary(sub.pendingPlan),
    recentBillingRecords: toBillingRecordSummaries(sub.billingRecords),
  };
}
