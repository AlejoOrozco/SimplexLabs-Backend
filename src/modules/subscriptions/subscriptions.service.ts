import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { planInclude, toPlanResponse } from '../plans/plan.mapper';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

const subscriptionInclude = {
  plan: { include: planInclude },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionWithPlan = Prisma.SubscriptionGetPayload<{
  include: typeof subscriptionInclude;
}>;

function toResponse(sub: SubscriptionWithPlan): SubscriptionResponseDto {
  return {
    id: sub.id,
    companyId: sub.companyId,
    planId: sub.planId,
    status: sub.status,
    initialPayment: sub.initialPayment.toString(),
    startedAt: sub.startedAt,
    nextBillingAt: sub.nextBillingAt,
    plan: toPlanResponse(sub.plan),
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  };
}

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    requester: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto[]> {
    const where = this.scopeWhere(requester);

    const rows = await this.prisma.subscription.findMany({
      where,
      include: subscriptionInclude,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toResponse);
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto> {
    const sub = await this.prisma.subscription.findUnique({
      where: { id },
      include: subscriptionInclude,
    });
    if (!sub) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }

    this.assertAccess(sub.companyId, requester);
    return toResponse(sub);
  }

  async create(dto: CreateSubscriptionDto): Promise<SubscriptionResponseDto> {
    await this.assertCompanyExists(dto.companyId);
    await this.assertPlanActive(dto.planId);

    try {
      const created = await this.prisma.subscription.create({
        data: {
          companyId: dto.companyId,
          planId: dto.planId,
          initialPayment: dto.initialPayment,
          startedAt: new Date(dto.startedAt),
          nextBillingAt: dto.nextBillingAt ? new Date(dto.nextBillingAt) : null,
        },
        include: subscriptionInclude,
      });
      return toResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new NotFoundException(
          `Subscription references a missing company or plan`,
        );
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateSubscriptionDto,
    requester: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto> {
    const existing = await this.prisma.subscription.findUnique({
      where: { id },
      select: { companyId: true },
    });
    if (!existing) {
      throw new NotFoundException(`Subscription ${id} not found`);
    }
    this.assertAccess(existing.companyId, requester);

    const data: Prisma.SubscriptionUpdateInput = {};
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.nextBillingAt !== undefined) {
      data.nextBillingAt = new Date(dto.nextBillingAt);
    }

    const updated = await this.prisma.subscription.update({
      where: { id },
      data,
      include: subscriptionInclude,
    });
    return toResponse(updated);
  }

  private scopeWhere(
    requester: AuthenticatedUser,
  ): Prisma.SubscriptionWhereInput {
    if (requester.role === 'SUPER_ADMIN') return {};
    if (!requester.companyId) {
      throw new ForbiddenException('Requester has no company scope');
    }
    return { companyId: requester.companyId };
  }

  private assertAccess(
    targetCompanyId: string,
    requester: AuthenticatedUser,
  ): void {
    if (requester.role === 'SUPER_ADMIN') return;
    if (targetCompanyId !== requester.companyId) {
      throw new ForbiddenException('Access denied to this subscription');
    }
  }

  private async assertCompanyExists(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) {
      throw new NotFoundException(`Company ${companyId} not found`);
    }
  }

  private async assertPlanActive(planId: string): Promise<void> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: { isActive: true },
    });
    if (!plan) {
      throw new NotFoundException(`Plan ${planId} not found`);
    }
    if (!plan.isActive) {
      throw new ForbiddenException(
        `Plan ${planId} is inactive and cannot be subscribed to`,
      );
    }
  }
}
