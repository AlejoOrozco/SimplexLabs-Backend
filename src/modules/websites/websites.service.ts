import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlanFeature, Prisma, SubStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateWebsiteDto } from './dto/create-website.dto';
import { UpdateWebsiteDto } from './dto/update-website.dto';
import { WebsiteResponseDto } from './dto/website-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';

const websiteSelect = {
  id: true,
  companyId: true,
  url: true,
  label: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WebsiteSelect;

const CHECK_LIVE_TIMEOUT_MS = 8000;

export interface WebsiteLiveCheckResult {
  isLive: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  checkedAt: string;
}

@Injectable()
export class WebsitesService {
  constructor(private readonly prisma: PrismaService) {}

  private async requestWithTimeout(
    url: string,
    method: 'HEAD' | 'GET',
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CHECK_LIVE_TIMEOUT_MS,
    );
    try {
      return await fetch(url, {
        method,
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async findAll(requester: AuthenticatedUser): Promise<WebsiteResponseDto[]> {
    return this.prisma.website.findMany({
      where: scopedCompanyWhere(requester),
      select: websiteSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    const record = await this.prisma.website.findUnique({
      where: { id },
      select: websiteSelect,
    });
    if (!record) {
      throw new NotFoundException(`Website ${id} not found`);
    }
    assertTenantAccess(record.companyId, requester);
    return record;
  }

  async create(
    dto: CreateWebsiteDto,
    requester: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    const companyId = resolveCompanyId(requester, dto.companyId);

    const hasWebsitePlan = await this.prisma.planIncludedFeature.findFirst({
      where: {
        feature: PlanFeature.WEBSITE,
        plan: {
          subscriptions: {
            some: {
              companyId,
              status: SubStatus.ACTIVE,
            },
          },
        },
      },
      select: { id: true },
    });

    if (!hasWebsitePlan) {
      throw new ForbiddenException(
        'This company does not have an active Website plan. Assign a Website plan before adding URLs.',
      );
    }

    try {
      return await this.prisma.website.create({
        data: {
          companyId,
          url: dto.url,
          label: dto.label ?? null,
          isActive: dto.isActive ?? true,
        },
        select: websiteSelect,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new NotFoundException(`Company ${companyId} not found`);
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateWebsiteDto,
    requester: AuthenticatedUser,
  ): Promise<WebsiteResponseDto> {
    await this.findOne(id, requester);

    return this.prisma.website.update({
      where: { id },
      data: dto,
      select: websiteSelect,
    });
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    await this.findOne(id, requester);

    await this.prisma.website.update({
      where: { id },
      data: { isActive: false },
      select: { id: true },
    });
    return { deleted: true };
  }

  async checkLive(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<WebsiteLiveCheckResult> {
    const website = await this.findOne(id, requester);
    const checkedAt = new Date().toISOString();
    const start = Date.now();
    try {
      let response = await this.requestWithTimeout(website.url, 'HEAD');
      if (response.status === 405 || response.status === 501) {
        response = await this.requestWithTimeout(website.url, 'GET');
      }
      return {
        isLive: response.ok,
        statusCode: response.status,
        responseTimeMs: Date.now() - start,
        checkedAt,
      };
    } catch {
      return {
        isLive: false,
        statusCode: null,
        responseTimeMs: null,
        checkedAt,
      };
    }
  }
}
