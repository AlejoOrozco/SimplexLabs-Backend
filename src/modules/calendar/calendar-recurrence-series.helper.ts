import { AppointmentStatus, Prisma, type Appointment } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateRecurringDto } from './dto/create-recurring.dto';
import {
  buildRecurrenceRRule,
  generateRecurrenceOccurrences,
} from './calendar-recurrence.util';

export async function persistRecurringAppointmentSeries(
  prisma: PrismaService,
  baseAppointmentId: string,
  base: Appointment,
  dto: CreateRecurringDto,
): Promise<{ created: number; occurrences: Date[] }> {
  const rrule = buildRecurrenceRRule(dto);
  const occurrences = generateRecurrenceOccurrences(base.scheduledAt, dto);
  const lastOccurrence = occurrences[occurrences.length - 1];
  if (!lastOccurrence) {
    return { created: 0, occurrences: [] };
  }

  await prisma.appointment.update({
    where: { id: baseAppointmentId },
    data: {
      isRecurring: true,
      recurrenceRule: rrule,
      recurrenceEndDate: lastOccurrence,
    },
  });

  const children: Prisma.AppointmentCreateManyInput[] = occurrences
    .slice(1)
    .map((scheduledAt) => ({
      companyId: base.companyId,
      organizerId: base.organizerId,
      contactId: base.contactId,
      staffId: base.staffId,
      productId: base.productId,
      title: base.title,
      description: base.description,
      type: base.type,
      status: AppointmentStatus.PENDING,
      scheduledAt,
      durationMinutes: base.durationMinutes,
      meetingUrl: base.meetingUrl,
      externalAttendeeName: base.externalAttendeeName,
      externalAttendeeEmail: base.externalAttendeeEmail,
      isRecurring: true,
      recurrenceParentId: baseAppointmentId,
      recurrenceRule: rrule,
      creatorTimezone: base.creatorTimezone,
    }));

  if (children.length > 0) {
    await prisma.appointment.createMany({ data: children });
  }

  return { created: children.length, occurrences };
}
