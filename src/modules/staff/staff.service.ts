import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffResponseDto } from './dto/staff-response.dto';
import { toStaffResponse } from './staff.mapper';

/**
 * Tenant-scoped CRUD for Staff members. Deactivation is a soft delete:
 * deactivated staff are hidden from availability and from agent-booking
 * candidates (AgentKnowledgeBase / retriever) without losing history.
 */
@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    requester: AuthenticatedUser,
    opts: { activeOnly?: boolean } = {},
  ): Promise<StaffResponseDto[]> {
    const where: Prisma.StaffWhereInput = {
      ...scopedCompanyWhere(requester),
      ...(opts.activeOnly ? { isActive: true } : {}),
    };
    const rows = await this.prisma.staff.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { firstName: 'asc' }],
    });
    return rows.map(toStaffResponse);
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<StaffResponseDto> {
    const row = await this.loadOrThrow(id, requester);
    return toStaffResponse(row);
  }

  async create(
    dto: CreateStaffDto,
    requester: AuthenticatedUser,
  ): Promise<StaffResponseDto> {
    if (!requester.companyId) {
      throw new ForbiddenException(
        'Only users scoped to a company can create staff',
      );
    }

    const row = await this.prisma.staff.create({
      data: {
        companyId: requester.companyId,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        email: dto.email?.trim().toLowerCase() ?? null,
        phone: dto.phone?.trim() ?? null,
        role: dto.role ?? 'EMPLOYEE',
      },
    });
    return toStaffResponse(row);
  }

  async update(
    id: string,
    dto: UpdateStaffDto,
    requester: AuthenticatedUser,
  ): Promise<StaffResponseDto> {
    await this.loadOrThrow(id, requester);

    const data: Prisma.StaffUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.email !== undefined) {
      data.email = dto.email === null ? null : dto.email.trim().toLowerCase();
    }
    if (dto.phone !== undefined) data.phone = dto.phone ?? null;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const row = await this.prisma.staff.update({ where: { id }, data });
    return toStaffResponse(row);
  }

  /** Soft delete: flips `isActive` to false. Preserves historical appointments. */
  async deactivate(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    await this.loadOrThrow(id, requester);
    await this.prisma.staff.update({
      where: { id },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  /**
   * Internal helper used by sibling services (WorkingHours, BlockedTimes,
   * Availability, Executor). Asserts the staff row exists AND belongs to the
   * requester's tenant. Returns the companyId so callers can use it as the
   * scope for downstream writes.
   */
  async assertOwnershipAndLoad(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<Staff> {
    return this.loadOrThrow(id, requester);
  }

  private async loadOrThrow(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<Staff> {
    const row = await this.prisma.staff.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Staff ${id} not found`);
    assertTenantAccess(row.companyId, requester);
    return row;
  }
}
