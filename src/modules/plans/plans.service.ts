import { Injectable, NotFoundException } from '@nestjs/common';
import { Niche, PlanCategory, PlanTier, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlanResponseDto } from './dto/plan-response.dto';
import { planInclude, toPlanResponse, PlanWithRelations } from './plan.mapper';

function uniqueValues<T>(values: T[] | undefined): T[] {
  if (!values) return [];
  return Array.from(new Set(values));
}

export interface PlansListFilters {
  readonly category?: PlanCategory;
  readonly niche?: Niche;
  readonly tier?: PlanTier;
}

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filters?: PlansListFilters): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: {
        isActive: true,
        ...(filters?.category !== undefined && { category: filters.category }),
        ...(filters?.niche !== undefined && { niche: filters.niche }),
        ...(filters?.tier !== undefined && { tier: filters.tier }),
      },
      include: planInclude,
      orderBy: [
        { niche: 'asc' },
        { category: 'asc' },
        { tier: 'asc' },
      ],
    });
    return plans.map(toPlanResponse);
  }

  async findByCategory(
    category: PlanCategory,
    niche?: Niche,
  ): Promise<PlanResponseDto[]> {
    const plans = await this.prisma.plan.findMany({
      where: {
        category,
        isActive: true,
        ...(niche !== undefined && { niche }),
      },
      include: planInclude,
      orderBy: { tier: 'asc' },
    });
    return plans.map(toPlanResponse);
  }

  async findOne(id: string): Promise<PlanResponseDto> {
    const plan = await this.loadOrThrow(id);
    return toPlanResponse(plan);
  }

  async create(dto: CreatePlanDto): Promise<PlanResponseDto> {
    const features = uniqueValues(dto.features);
    const channels = uniqueValues(dto.channels);

    const created = await this.prisma.plan.create({
      data: {
        name: dto.name,
        niche: dto.niche,
        category: dto.category,
        tier: dto.tier,
        priceMonthly: dto.priceMonthly,
        priceAnnual: dto.priceAnnual,
        setupFee: dto.setupFee,
        maxCampaigns: dto.maxCampaigns,
        description: dto.description,
        includedFeatures: features.length
          ? { create: features.map((feature) => ({ feature })) }
          : undefined,
        planChannels: channels.length
          ? { create: channels.map((channel) => ({ channel })) }
          : undefined,
      },
      include: planInclude,
    });

    return toPlanResponse(created);
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

    return toPlanResponse(updated);
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
