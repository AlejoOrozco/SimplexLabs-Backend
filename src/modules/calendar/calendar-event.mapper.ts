import { Prisma } from '@prisma/client';
import type { CalendarEventDto } from './calendar.types';

const calendarEventInclude = {
  organizer: { select: { id: true, firstName: true, lastName: true } },
  contact: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
  staff: { select: { id: true, firstName: true, lastName: true } },
  company: { select: { id: true, name: true } },
  appointment_attendees: {
    select: {
      user_id: true,
      invitation_status: true,
    },
  },
} satisfies Prisma.AppointmentInclude;

export type AppointmentCalendarRow = Prisma.AppointmentGetPayload<{
  include: typeof calendarEventInclude;
}>;

export { calendarEventInclude };

export function mapAppointmentToCalendarEvent(
  appt: AppointmentCalendarRow,
  viewerUserId: string,
): CalendarEventDto {
  const endTime = new Date(appt.scheduledAt);
  endTime.setMinutes(endTime.getMinutes() + appt.durationMinutes);

  const staffMember = appt.staff
    ? {
        id: appt.staff.id,
        name: `${appt.staff.firstName} ${appt.staff.lastName}`.trim(),
      }
    : null;

  const isOrganizer = appt.organizerId === viewerUserId;
  const attendeeRow = appt.appointment_attendees.find(
    (row) => row.user_id === viewerUserId,
  );
  const isInvitee = attendeeRow != null;
  const invitationStatus = isInvitee ? attendeeRow.invitation_status : null;
  const viewerRole = isOrganizer
    ? 'organizer'
    : isInvitee
      ? 'invitee'
      : 'member';

  return {
    id: appt.id,
    title: appt.title,
    start: appt.scheduledAt.toISOString(),
    end: endTime.toISOString(),
    extendedProps: {
      type: appt.type,
      status: appt.status,
      callMeAsap: appt.callMeAsap,
      organizer: appt.organizer,
      contact: appt.contact,
      staffMember,
      company: appt.company,
      description: appt.description,
      meetingUrl: appt.meetingUrl,
      isRecurring: appt.isRecurring,
      recurrenceParentId: appt.recurrenceParentId,
      recurrenceRule: appt.recurrenceRule,
      durationMinutes: appt.durationMinutes,
      creatorTimezone: appt.creatorTimezone,
      isOrganizer,
      isInvitee,
      viewerRole,
      invitationStatus,
      invitationPending: invitationStatus === 'PENDING',
    },
    editable: isOrganizer,
  };
}
