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
    priceMonthly: plan.priceMonthly.toString(),
    setupFee: plan.setupFee.toString(),
    isActive: plan.isActive,
    features: plan.includedFeatures.map((f) => f.feature),
    channels: plan.planChannels.map((c) => c.channel),
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
