import { ForbiddenException } from '@nestjs/common';
import { AppointmentStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CalendarAdminScope, CalendarQueryDto } from './dto/calendar-query.dto';

/**
 * Builds the Prisma filter for calendar events so invitees see cross-company
 * meetings on their calendar (mirrors `AppointmentsService.findAll` scope).
 */
export function buildCalendarEventsWhere(
  dto: CalendarQueryDto,
  user: AuthenticatedUser,
  range: { start: Date; end: Date },
): Prisma.AppointmentWhereInput {
  const base: Prisma.AppointmentWhereInput = {
    scheduledAt: { gte: range.start, lte: range.end },
    status: { not: AppointmentStatus.CANCELLED },
  };

  if (dto.staffMemberId) {
    base.staffId = dto.staffMemberId;
  }

  if (user.roleName === 'SUPER_ADMIN') {
    if (dto.scope === CalendarAdminScope.MINE) {
      return {
        ...base,
        OR: [
          { organizerId: user.id },
          {
            appointment_attendees: {
              some: { user_id: user.id },
            },
          },
        ],
      };
    }

    if (dto.companyId) {
      return { ...base, companyId: dto.companyId };
    }

    return base;
  }

  if (!user.companyId) {
    throw new ForbiddenException('Requester has no company scope');
  }

  return {
    ...base,
    OR: [
      { companyId: user.companyId },
      { organizerId: user.id },
      {
        appointment_attendees: {
          some: { user_id: user.id },
        },
      },
    ],
  };
}
