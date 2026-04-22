import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { BlockedTime, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import {
  BlockedTimeResponseDto,
  CreateBlockedTimeDto,
  ListBlockedTimesQueryDto,
} from './dto/blocked-time.dto';

function toResponse(row: BlockedTime): BlockedTimeResponseDto {
  return {
    id: row.id,
    companyId: row.companyId,
    staffId: row.staffId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reason: row.reason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class BlockedTimesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    requester: AuthenticatedUser,
    query: ListBlockedTimesQueryDto,
  ): Promise<BlockedTimeResponseDto[]> {
    const where: Prisma.BlockedTimeWhereInput = {
      ...scopedCompanyWhere(requester),
    };
    if (query.staffId !== undefined) where.staffId = query.staffId;

    // Overlap filter: return blocks that intersect [from, to).
    if (query.from !== undefined) {
      where.endsAt = { gt: new Date(query.from) };
    }
    if (query.to !== undefined) {
      where.startsAt = { lt: new Date(query.to) };
    }

    const rows = await this.prisma.blockedTime.findMany({
      where,
      orderBy: { startsAt: 'asc' },
    });
    return rows.map(toResponse);
  }

  async create(
    dto: CreateBlockedTimeDto,
    requester: AuthenticatedUser,
  ): Promise<BlockedTimeResponseDto> {
    if (!requester.companyId) {
      throw new ForbiddenException(
        'Only users scoped to a company can create blocked times',
      );
    }
    const companyId = requester.companyId;

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf())) {
      throw new BadRequestException('Invalid startsAt/endsAt');
    }
    if (endsAt <= startsAt) {
      throw new BadRequestException('endsAt must be strictly after startsAt');
    }

    if (dto.staffId !== undefined) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: dto.staffId },
        select: { companyId: true },
      });
      if (!staff) throw new NotFoundException(`Staff ${dto.staffId} not found`);
      if (staff.companyId !== companyId) {
        throw new ForbiddenException('Staff does not belong to your company');
      }
    }

    const row = await this.prisma.blockedTime.create({
      data: {
        companyId,
        staffId: dto.staffId ?? null,
        startsAt,
        endsAt,
        reason: dto.reason ?? null,
      },
    });
    return toResponse(row);
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    const row = await this.prisma.blockedTime.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Blocked time ${id} not found`);
    assertTenantAccess(row.companyId, requester);
    await this.prisma.blockedTime.delete({ where: { id } });
    return { deleted: true };
  }
}
