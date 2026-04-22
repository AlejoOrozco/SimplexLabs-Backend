import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { WorkingHours } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { StaffService } from './staff.service';
import {
  CreateWorkingHoursDto,
  WorkingHoursResponseDto,
} from './dto/working-hours.dto';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function toResponse(row: WorkingHours): WorkingHoursResponseDto {
  return {
    id: row.id,
    staffId: row.staffId,
    dayOfWeek: row.dayOfWeek,
    startTime: row.startTime,
    endTime: row.endTime,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class WorkingHoursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly staff: StaffService,
  ) {}

  async list(
    staffId: string,
    requester: AuthenticatedUser,
  ): Promise<WorkingHoursResponseDto[]> {
    await this.staff.assertOwnershipAndLoad(staffId, requester);
    const rows = await this.prisma.workingHours.findMany({
      where: { staffId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map(toResponse);
  }

  async create(
    staffId: string,
    dto: CreateWorkingHoursDto,
    requester: AuthenticatedUser,
  ): Promise<WorkingHoursResponseDto> {
    await this.staff.assertOwnershipAndLoad(staffId, requester);

    const start = toMinutes(dto.startTime);
    const end = toMinutes(dto.endTime);
    if (end <= start) {
      throw new BadRequestException('endTime must be strictly after startTime');
    }

    // Overlap check: any existing row for (staff, dayOfWeek) whose interval
    // intersects [start, end). Two intervals overlap when
    // existing.start < new.end AND existing.end > new.start.
    const existing = await this.prisma.workingHours.findMany({
      where: { staffId, dayOfWeek: dto.dayOfWeek },
      select: { id: true, startTime: true, endTime: true },
    });
    const overlaps = existing.some((row) => {
      const rs = toMinutes(row.startTime);
      const re = toMinutes(row.endTime);
      return rs < end && re > start;
    });
    if (overlaps) {
      throw new ConflictException(
        'Overlapping working hours for the same staff/day',
      );
    }

    const row = await this.prisma.workingHours.create({
      data: {
        staffId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
    return toResponse(row);
  }

  async remove(
    staffId: string,
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    await this.staff.assertOwnershipAndLoad(staffId, requester);
    const row = await this.prisma.workingHours.findUnique({ where: { id } });
    if (!row || row.staffId !== staffId) {
      throw new NotFoundException(`Working hours ${id} not found`);
    }
    await this.prisma.workingHours.delete({ where: { id } });
    return { deleted: true };
  }
}
