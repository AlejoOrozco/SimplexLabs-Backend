import { Injectable } from '@nestjs/common';
import { Niche, PlanCategory, PlanTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanResponseDto } from './dto/plan-response.dto';
import { planInclude, toPlanResponse } from './plan.mapper';

export interface PlansListFilters {
  readonly category?: PlanCategory;
  readonly niche?: Niche;
  readonly tier?: PlanTier;
}

export interface AdminPlansListFilters extends PlansListFilters {
  readonly activeOnly?: boolean;
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

  async findAllAdmin(
    filters?: AdminPlansListFilters,
  ): Promise<PlanResponseDto[]> {
    const isActiveFilter =
      filters?.activeOnly === true
        ? { isActive: true }
        : filters?.activeOnly === false
          ? { isActive: false }
          : {};

    const plans = await this.prisma.plan.findMany({
      where: {
        ...isActiveFilter,
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
}
