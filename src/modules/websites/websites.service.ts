import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

@Injectable()
export class WebsitesService {
  constructor(private readonly prisma: PrismaService) {}

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
}
