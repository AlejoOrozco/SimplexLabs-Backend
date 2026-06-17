import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { assertTenantAccess } from '../../common/tenant/tenant-scope';
import { NotificationsService } from '../notifications/notifications.service';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { MoveAppointmentDto } from './dto/move-appointment.dto';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { persistRecurringAppointmentSeries } from './calendar-recurrence-series.helper';
import { buildCalendarEventsWhere } from './calendar-events-scope.helper';
import {
  calendarEventInclude,
  mapAppointmentToCalendarEvent,
} from './calendar-event.mapper';
import {
  evaluateWorkingHoursAndBlocks,
  findConflictingAppointments,
  resolveCompanyIdForAvailability,
} from './calendar-availability.helper';
import { notifyAppointmentReschedule } from './calendar-reschedule-notification.helper';
import type {
  CalendarEventDto,
  CheckAvailabilityResult,
} from './calendar.types';

const DEFAULT_COMPANY_TZ = 'America/Mexico_City';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getCalendarEvents(
    dto: CalendarQueryDto,
    user: AuthenticatedUser,
  ): Promise<CalendarEventDto[]> {
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
      throw new BadRequestException('Invalid start or end date');
    }
    if (end < start) {
      throw new BadRequestException('end must be after start');
    }

    const where = buildCalendarEventsWhere(dto, user, { start, end });

    const appointments = await this.prisma.appointment.findMany({
      where,
      include: calendarEventInclude,
      orderBy: { scheduledAt: 'asc' },
    });

    return appointments.map((row) =>
      mapAppointmentToCalendarEvent(row, user.id),
    );
  }

  async checkAvailability(
    dto: CheckAvailabilityDto,
    user: AuthenticatedUser,
  ): Promise<CheckAvailabilityResult> {
    const companyId = resolveCompanyIdForAvailability(dto, user);
    const proposedStart = new Date(dto.proposedStart);
    if (Number.isNaN(proposedStart.valueOf())) {
      throw new BadRequestException('Invalid proposedStart');
    }
    const proposedEnd = new Date(
      proposedStart.getTime() + dto.durationMinutes * 60_000,
    );

    const conflicts = await findConflictingAppointments(this.prisma, {
      companyId,
      proposedStart,
      proposedEnd,
      staffId: dto.staffMemberId ?? null,
      excludeAppointmentId: dto.excludeAppointmentId,
    });

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId },
      select: { timezone: true },
    });
    const companyTz = settings?.timezone ?? DEFAULT_COMPANY_TZ;

    const { withinWorkingHours, workingHoursReason } =
      await evaluateWorkingHoursAndBlocks(this.prisma, {
        companyId,
        companyTz,
        staffId: dto.staffMemberId ?? null,
        proposedStart,
        proposedEnd,
      });

    return {
      available: conflicts.length === 0 && withinWorkingHours,
      conflicts,
      withinWorkingHours,
      workingHoursReason,
    };
  }

  async moveAppointment(
    appointmentId: string,
    dto: MoveAppointmentDto,
    user: AuthenticatedUser,
  ): Promise<{
    id: string;
    scheduledAt: Date;
    durationMinutes: number;
    status: AppointmentStatus;
  }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        organizer: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
      },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found`);
    }
    assertTenantAccess(appointment.companyId, user);

    if (appointment.organizerId !== user.id) {
      throw new ForbiddenException(
        'Only the organizer can reschedule this appointment',
      );
    }

    const newStart = new Date(dto.newStart);
    const newEnd = new Date(dto.newEnd);
    if (Number.isNaN(newStart.valueOf()) || Number.isNaN(newEnd.valueOf())) {
      throw new BadRequestException('Invalid newStart or newEnd');
    }
    if (newEnd <= newStart) {
      throw new BadRequestException('newEnd must be after newStart');
    }

    const durationMinutes = Math.round(
      (newEnd.getTime() - newStart.getTime()) / 60_000,
    );
    if (durationMinutes < 15) {
      throw new BadRequestException('Duration must be at least 15 minutes');
    }

    const availability = await this.checkAvailability(
      {
        proposedStart: dto.newStart,
        durationMinutes,
        staffMemberId: appointment.staffId ?? undefined,
        excludeAppointmentId: appointmentId,
        companyId:
          user.roleName === 'SUPER_ADMIN' ? appointment.companyId : undefined,
      },
      user,
    );

    if (!availability.available) {
      throw new BadRequestException({
        message: 'The selected time slot is not available',
        conflicts: availability.conflicts,
        workingHoursReason: availability.workingHoursReason,
      });
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        scheduledAt: newStart,
        durationMinutes,
        status: AppointmentStatus.PENDING,
      },
      select: {
        id: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
      },
    });

    await notifyAppointmentReschedule(
      this.logger,
      this.notifications,
      appointment,
      user,
    );

    return updated;
  }

  async createRecurringAppointments(
    baseAppointmentId: string,
    dto: CreateRecurringDto,
    user: AuthenticatedUser,
  ): Promise<{
    parentId: string;
    created: number;
    occurrences: string[];
  }> {
    const base = await this.prisma.appointment.findUnique({
      where: { id: baseAppointmentId },
    });

    if (!base) {
      throw new NotFoundException('Base appointment not found');
    }
    assertTenantAccess(base.companyId, user);

    if (base.organizerId !== user.id && user.roleName !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Only the organizer can make this appointment recurring',
      );
    }

    const { created, occurrences } = await persistRecurringAppointmentSeries(
      this.prisma,
      baseAppointmentId,
      base,
      dto,
    );
    if (occurrences.length === 0) {
      throw new BadRequestException('No recurrence occurrences generated');
    }

    return {
      parentId: baseAppointmentId,
      created,
      occurrences: occurrences.map((d) => d.toISOString()),
    };
  }

  async getStaffMembers(
    companyId: string,
    requester: AuthenticatedUser,
  ): Promise<Array<{ id: string; name: string; role: string }>> {
    if (!companyId) {
      throw new BadRequestException('companyId is required');
    }
    assertTenantAccess(companyId, requester);

    const rows = await this.prisma.staff.findMany({
      where: { companyId, isActive: true },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return rows.map((s) => ({
      id: s.id,
      name: `${s.firstName} ${s.lastName}`.trim(),
      role: s.role,
    }));
  }
}
