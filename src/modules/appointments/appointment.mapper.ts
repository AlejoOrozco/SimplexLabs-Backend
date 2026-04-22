import { Prisma } from '@prisma/client';
import { AppointmentResponseDto } from './dto/appointment-response.dto';

export const appointmentInclude = {
  organizer: {
    select: { id: true, firstName: true, lastName: true },
  },
  contact: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  },
  product: {
    select: { id: true, name: true, type: true, price: true },
  },
  staff: {
    select: { id: true, firstName: true, lastName: true, role: true },
  },
} satisfies Prisma.AppointmentInclude;

export type AppointmentWithRelations = Prisma.AppointmentGetPayload<{
  include: typeof appointmentInclude;
}>;

export function toAppointmentResponse(
  appt: AppointmentWithRelations,
): AppointmentResponseDto {
  return {
    id: appt.id,
    companyId: appt.companyId,
    organizerId: appt.organizerId,
    contactId: appt.contactId,
    productId: appt.productId,
    title: appt.title,
    description: appt.description,
    type: appt.type,
    status: appt.status,
    scheduledAt: appt.scheduledAt,
    durationMinutes: appt.durationMinutes,
    meetingUrl: appt.meetingUrl,
    externalAttendeeName: appt.externalAttendeeName,
    externalAttendeeEmail: appt.externalAttendeeEmail,
    createdAt: appt.createdAt,
    updatedAt: appt.updatedAt,
    organizer: {
      id: appt.organizer.id,
      firstName: appt.organizer.firstName,
      lastName: appt.organizer.lastName,
    },
    contact: appt.contact
      ? {
          id: appt.contact.id,
          firstName: appt.contact.firstName,
          lastName: appt.contact.lastName,
          email: appt.contact.email,
          phone: appt.contact.phone,
        }
      : null,
    product: appt.product
      ? {
          id: appt.product.id,
          name: appt.product.name,
          type: appt.product.type,
          price: appt.product.price.toString(),
        }
      : null,
    staffId: appt.staffId,
    staff: appt.staff
      ? {
          id: appt.staff.id,
          firstName: appt.staff.firstName,
          lastName: appt.staff.lastName,
          role: appt.staff.role,
        }
      : null,
  };
}
