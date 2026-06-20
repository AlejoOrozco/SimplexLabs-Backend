import { AppointmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getZonedParts } from '../scheduling/timezone.util';

export async function findConflictingAppointments(
  prisma: PrismaService,
  args: {
    companyId: string;
    proposedStart: Date;
    proposedEnd: Date;
    staffId: string | null;
    excludeAppointmentId?: string;
  },
): Promise<Array<{ id: string; title: string; scheduledAt: Date }>> {
  const {
    companyId,
    proposedStart,
    proposedEnd,
    staffId,
    excludeAppointmentId,
  } = args;

  const where: Prisma.AppointmentWhereInput = {
    companyId,
    status: { not: AppointmentStatus.CANCELLED },
    scheduledAt: { lt: proposedEnd },
    ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
    ...(staffId ? { staffId } : {}),
  };

  const candidates = await prisma.appointment.findMany({
    where,
    select: { id: true, title: true, scheduledAt: true, durationMinutes: true },
  });

  return candidates.filter((a) => {
    const aEnd = new Date(
      a.scheduledAt.getTime() + a.durationMinutes * 60_000,
    );
    return aEnd > proposedStart;
  });
}

export async function evaluateWorkingHoursAndBlocks(
  prisma: PrismaService,
  args: {
    companyId: string;
    companyTz: string;
    staffId: string | null;
    proposedStart: Date;
    proposedEnd: Date;
  },
): Promise<{ withinWorkingHours: boolean; workingHoursReason?: string }> {
  const { companyId, companyTz, staffId, proposedStart, proposedEnd } = args;

  const blockWhere: Prisma.BlockedTimeWhereInput = {
    companyId,
    startsAt: { lt: proposedEnd },
    endsAt: { gt: proposedStart },
    ...(staffId
      ? { OR: [{ staffId: null }, { staffId }] }
      : { staffId: null }),
  };

  const blocked = await prisma.blockedTime.findFirst({
    where: blockWhere,
  });
  if (blocked) {
    return {
      withinWorkingHours: false,
      workingHoursReason: `Blocked: ${blocked.reason ?? 'Unavailable'}`,
    };
  }

  if (!staffId) {
    return { withinWorkingHours: true };
  }

  const staff = await prisma.staff.findFirst({
    where: { id: staffId, companyId, isActive: true },
    select: { id: true },
  });
  if (!staff) {
    return {
      withinWorkingHours: false,
      workingHoursReason: 'Staff not found or inactive',
    };
  }

  const zoned = getZonedParts(proposedStart, companyTz);
  const timeString = `${String(zoned.hour).padStart(2, '0')}:${String(zoned.minute).padStart(2, '0')}`;

  const whRows = await prisma.workingHours.findMany({
    where: { staffId, dayOfWeek: zoned.dayOfWeek },
    select: { startTime: true, endTime: true },
  });

  if (whRows.length === 0) {
    return {
      withinWorkingHours: false,
      workingHoursReason: 'No working hours configured for this day',
    };
  }

  const inAnyWindow = whRows.some(
    (wh) => timeString >= wh.startTime && timeString < wh.endTime,
  );

  if (!inAnyWindow) {
    const first = whRows[0];
    return {
      withinWorkingHours: false,
      workingHoursReason: `Outside working hours (${first.startTime} – ${first.endTime})`,
    };
  }

  return { withinWorkingHours: true };
}
