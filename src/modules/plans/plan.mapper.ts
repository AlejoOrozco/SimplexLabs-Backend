import { Prisma } from '@prisma/client';
import { PlanResponseDto } from './dto/plan-response.dto';

export const planInclude = {
  includedFeatures: { select: { feature: true } },
  planChannels: { select: { channel: true } },
} satisfies Prisma.PlanInclude;

export type PlanWithRelations = Prisma.PlanGetPayload<{
  include: typeof planInclude;
}>;

export function toPlanResponse(plan: PlanWithRelations): PlanResponseDto {
  return {
    id: plan.id,
    name: plan.name,
    niche: plan.niche,
    category: plan.category ?? null,
    tier: plan.tier ?? null,
    priceMonthly: plan.priceMonthly.toString(),
    priceAnnual: plan.priceAnnual ? plan.priceAnnual.toString() : null,
    setupFee: plan.setupFee.toString(),
    maxCampaigns: plan.maxCampaigns ?? null,
    description: plan.description ?? null,
    isActive: plan.isActive,
    features: plan.includedFeatures.map((f) => f.feature),
    channels: plan.planChannels.map((c) => c.channel),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
