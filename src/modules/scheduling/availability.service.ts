import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { assertTenantAccess } from '../../common/tenant/tenant-scope';
import {
  enumerateZonedDates,
  parseHHmm,
  zonedWallTimeToUtc,
} from './timezone.util';
import {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
  AvailabilitySlotDto,
} from './dto/availability.dto';

const DEFAULT_TIMEZONE = 'America/Mexico_City';
const DEFAULT_SLOT_MINUTES = 30;

/** Constants that gate pathological query windows. */
const MAX_WINDOW_DAYS = 62;

const BUSY_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
];

export interface AvailabilityComputeInput {
  companyId: string;
  fromUtc: Date;
  toUtc: Date;
  staffId?: string;
  durationMinutes?: number;
}

export interface AvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
  staffId: string;
  staffName: string;
}

/**
 * Pure, deterministic availability engine.
 *
 * Given a date window in UTC, a company (timezone-aware) and optional staff
 * filter, computes the set of bookable slots that satisfy ALL of:
 *   - within an active staff member's WorkingHours for the correct weekday,
 *   - not intersecting any company-wide or staff-specific BlockedTime,
 *   - not intersecting any PENDING/CONFIRMED Appointment for the same staff,
 *   - slot aligned to `durationMinutes` (default from CompanySettings),
 *   - fully contained in [fromUtc, toUtc).
 *
 * Ordering is stable: (startsAt asc, staffId asc).
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Tenant-safe entrypoint used by the HTTP controller. Derives companyId
   * from the authenticated user (never trusts client input).
   */
  async findForRequester(
    requester: AuthenticatedUser,
    query: AvailabilityQueryDto,
  ): Promise<AvailabilityResponseDto> {
    if (!requester.companyId) {
      throw new ForbiddenException('Requester has no company scope');
    }
    const fromUtc = new Date(query.from);
    const toUtc = new Date(query.to);
    if (Number.isNaN(fromUtc.valueOf()) || Number.isNaN(toUtc.valueOf())) {
      throw new BadRequestException('Invalid from/to');
    }
    if (toUtc <= fromUtc) {
      throw new BadRequestException('`to` must be after `from`');
    }
    const windowDays =
      (toUtc.getTime() - fromUtc.getTime()) / (1000 * 60 * 60 * 24);
    if (windowDays > MAX_WINDOW_DAYS) {
      throw new BadRequestException(
        `Availability windows cannot exceed ${MAX_WINDOW_DAYS} days`,
      );
    }

    if (query.staffId !== undefined) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: query.staffId },
        select: { companyId: true },
      });
      if (!staff) {
        throw new NotFoundException(`Staff ${query.staffId} not found`);
      }
      assertTenantAccess(staff.companyId, requester);
    }

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId: requester.companyId },
      select: { timezone: true, defaultSlotDurationMinutes: true },
    });
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
    const defaultSlotMinutes =
      settings?.defaultSlotDurationMinutes ?? DEFAULT_SLOT_MINUTES;
    const durationMinutes = query.durationMinutes ?? defaultSlotMinutes;

    const slots = await this.compute({
      companyId: requester.companyId,
      fromUtc,
      toUtc,
      staffId: query.staffId,
      durationMinutes,
    });

    return {
      companyId: requester.companyId,
      timezone,
      durationMinutes,
      from: fromUtc,
      to: toUtc,
      slots: slots.map(
        (s): AvailabilitySlotDto => ({
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          staffId: s.staffId,
          staffName: s.staffName,
        }),
      ),
    };
  }

  /**
   * Pure computation — no auth. Called directly by:
   *   - findForRequester (authenticated)
   *   - Executor (trusted caller already scoped to company)
   */
  async compute(input: AvailabilityComputeInput): Promise<AvailabilitySlot[]> {
    const { companyId, fromUtc, toUtc, staffId } = input;
    const duration = input.durationMinutes ?? DEFAULT_SLOT_MINUTES;
    const durationMs = duration * 60 * 1000;

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId },
      select: { timezone: true },
    });
    const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;

    const staffRows = await this.prisma.staff.findMany({
      where: {
        companyId,
        isActive: true,
        ...(staffId !== undefined ? { id: staffId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        workingHours: {
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
      },
    });
    if (staffRows.length === 0) return [];
    const staffIds = staffRows.map((s) => s.id);

    // Fetch blockers that intersect [fromUtc, toUtc) in ONE query.
    const blockedTimes = await this.prisma.blockedTime.findMany({
      where: {
        companyId,
        startsAt: { lt: toUtc },
        endsAt: { gt: fromUtc },
        OR: [{ staffId: null }, { staffId: { in: staffIds } }],
      },
      select: { staffId: true, startsAt: true, endsAt: true },
    });

    // Busy appointments: PENDING/CONFIRMED for ANY candidate staff whose
    // range intersects the window.
    const appointments = await this.prisma.appointment.findMany({
      where: {
        companyId,
        status: { in: BUSY_STATUSES },
        staffId: { in: staffIds },
        scheduledAt: { lt: toUtc },
      },
      select: { staffId: true, scheduledAt: true, durationMinutes: true },
    });
    // Keep only those whose end is after fromUtc.
    const busyByStaff = new Map<string, { start: Date; end: Date }[]>();
    for (const a of appointments) {
      if (!a.staffId) continue;
      const start = a.scheduledAt;
      const end = new Date(start.getTime() + a.durationMinutes * 60 * 1000);
      if (end <= fromUtc) continue;
      const arr = busyByStaff.get(a.staffId) ?? [];
      arr.push({ start, end });
      busyByStaff.set(a.staffId, arr);
    }

    // Partition blocks: company-wide vs staff-specific.
    const companyBlocks: { start: Date; end: Date }[] = [];
    const staffBlocks = new Map<string, { start: Date; end: Date }[]>();
    for (const b of blockedTimes) {
      const range = { start: b.startsAt, end: b.endsAt };
      if (b.staffId === null) {
        companyBlocks.push(range);
      } else {
        const arr = staffBlocks.get(b.staffId) ?? [];
        arr.push(range);
        staffBlocks.set(b.staffId, arr);
      }
    }

    const days = enumerateZonedDates(fromUtc, toUtc, timezone);
    const out: AvailabilitySlot[] = [];

    for (const staff of staffRows) {
      const whByDow = new Map<
        number,
        { startTime: string; endTime: string }[]
      >();
      for (const wh of staff.workingHours) {
        const arr = whByDow.get(wh.dayOfWeek) ?? [];
        arr.push({ startTime: wh.startTime, endTime: wh.endTime });
        whByDow.set(wh.dayOfWeek, arr);
      }

      const staffBusy = busyByStaff.get(staff.id) ?? [];
      const perStaffBlocks = staffBlocks.get(staff.id) ?? [];
      const obstacles = [
        ...companyBlocks,
        ...perStaffBlocks,
        ...staffBusy,
      ];
      const staffName = `${staff.firstName} ${staff.lastName}`.trim();

      for (const d of days) {
        const intervals = whByDow.get(d.dayOfWeek) ?? [];
        for (const wh of intervals) {
          const { h: sh, m: sm } = parseHHmm(wh.startTime);
          const { h: eh, m: em } = parseHHmm(wh.endTime);
          const intervalStart = zonedWallTimeToUtc(
            d.year,
            d.month,
            d.day,
            sh,
            sm,
            timezone,
          );
          const intervalEnd = zonedWallTimeToUtc(
            d.year,
            d.month,
            d.day,
            eh,
            em,
            timezone,
          );

          // Clip to query window.
          const clipStart = new Date(
            Math.max(intervalStart.getTime(), fromUtc.getTime()),
          );
          const clipEnd = new Date(
            Math.min(intervalEnd.getTime(), toUtc.getTime()),
          );
          if (clipEnd.getTime() - clipStart.getTime() < durationMs) continue;

          // Align slot start to the interval start (not to the clip); this
          // keeps slots stable as the window slides.
          let cursor = intervalStart.getTime();
          while (cursor + durationMs <= intervalEnd.getTime()) {
            const slotStart = new Date(cursor);
            const slotEnd = new Date(cursor + durationMs);

            const withinWindow =
              slotStart.getTime() >= fromUtc.getTime() &&
              slotEnd.getTime() <= toUtc.getTime();

            if (withinWindow && !this.overlapsAny(slotStart, slotEnd, obstacles)) {
              out.push({
                startsAt: slotStart,
                endsAt: slotEnd,
                staffId: staff.id,
                staffName,
              });
            }
            cursor += durationMs;
          }
        }
      }
    }

    // Deterministic ordering for stable client-side rendering.
    out.sort((a, b) => {
      const d = a.startsAt.getTime() - b.startsAt.getTime();
      if (d !== 0) return d;
      return a.staffId.localeCompare(b.staffId);
    });
    return out;
  }

  /**
   * Boolean gate used by the Executor right before creating an appointment:
   * does the exact [startsAt, startsAt + duration) slot remain bookable for
   * the given staff? This is the "last line of defense" against stale-slot
   * races between availability preview and actual write.
   */
  async isSlotAvailable(args: {
    companyId: string;
    staffId: string;
    startsAt: Date;
    durationMinutes: number;
  }): Promise<boolean> {
    const endsAt = new Date(
      args.startsAt.getTime() + args.durationMinutes * 60 * 1000,
    );
    const slots = await this.compute({
      companyId: args.companyId,
      fromUtc: args.startsAt,
      toUtc: endsAt,
      staffId: args.staffId,
      durationMinutes: args.durationMinutes,
    });
    return slots.some(
      (s) =>
        s.staffId === args.staffId &&
        s.startsAt.getTime() === args.startsAt.getTime(),
    );
  }

  private overlapsAny(
    start: Date,
    end: Date,
    ranges: { start: Date; end: Date }[],
  ): boolean {
    const s = start.getTime();
    const e = end.getTime();
    for (const r of ranges) {
      if (r.start.getTime() < e && r.end.getTime() > s) return true;
    }
    return false;
  }
}
