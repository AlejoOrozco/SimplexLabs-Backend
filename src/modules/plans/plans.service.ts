import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlanResponseDto } from './dto/plan-response.dto';

const planInclude = {
  includedFeatures: { select: { feature: true } },
  planChannels: { select: { channel: true } },
} satisfies Prisma.PlanInclude;

type PlanWithRelations = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

function toResponse(plan: PlanWithRelations): PlanResponseDto {
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

function uniqueValues<T>(values: T[] | undefined): T[] {
  if (!values) return [];
  return Array.from(new Set(values));
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      include: planInclude,
      orderBy: [{ niche: 'asc' }, { priceMonthly: 'asc' }],
    });
    return plans.map(toResponse);
  }

  async findOne(id: string): Promise<PlanResponseDto> {
    const plan = await this.loadOrThrow(id);
    return toResponse(plan);
  }

  async create(dto: CreatePlanDto): Promise<PlanResponseDto> {
    const features = uniqueValues(dto.features);
    const channels = uniqueValues(dto.channels);

    const created = await this.prisma.plan.create({
      data: {
        name: dto.name,
        niche: dto.niche,
        priceMonthly: dto.priceMonthly,
        setupFee: dto.setupFee,
        includedFeatures: features.length
          ? { create: features.map((feature) => ({ feature })) }
          : undefined,
        planChannels: channels.length
          ? { create: channels.map((channel) => ({ channel })) }
          : undefined,
      },
      include: planInclude,
    });

    return toResponse(created);
  }

  async update(id: string, dto: UpdatePlanDto): Promise<PlanResponseDto> {
    await this.loadOrThrow(id);

    const { features, channels, ...rest } = dto;
    const planData: Prisma.PlanUpdateInput = { ...rest };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (features !== undefined) {
        const deduped = uniqueValues(features);
        await tx.planIncludedFeature.deleteMany({ where: { planId: id } });
        if (deduped.length > 0) {
          await tx.planIncludedFeature.createMany({
            data: deduped.map((feature) => ({ planId: id, feature })),
          });
        }
      }

      if (channels !== undefined) {
        const deduped = uniqueValues(channels);
        await tx.planChannel.deleteMany({ where: { planId: id } });
        if (deduped.length > 0) {
          await tx.planChannel.createMany({
            data: deduped.map((channel) => ({ planId: id, channel })),
          });
        }
      }

      return tx.plan.update({
        where: { id },
        data: planData,
        include: planInclude,
      });
    });

    return toResponse(updated);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    try {
      await this.prisma.plan.update({
        where: { id },
        data: { isActive: false },
      });
      return { deleted: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Plan ${id} not found`);
      }
      throw err;
    }
  }

  private async loadOrThrow(id: string): Promise<PlanWithRelations> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: planInclude,
    });
    if (!plan) {
      throw new NotFoundException(`Plan ${id} not found`);
    }
    return plan;
  }
}
