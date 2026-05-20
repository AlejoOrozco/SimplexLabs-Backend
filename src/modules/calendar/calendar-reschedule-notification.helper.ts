import type { Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { NotificationsService } from '../notifications/notifications.service';

export async function notifyAppointmentReschedule(
  logger: Logger,
  notifications: NotificationsService,
  appointment: { id: string; companyId: string },
  mover: AuthenticatedUser,
): Promise<void> {
  try {
    await notifications.create({
      companyId: appointment.companyId,
      type: NotificationType.APPOINTMENT_REQUESTED,
      title: 'Appointment rescheduled',
      body: `An appointment was moved and may need confirmation.`,
      payload: {
        appointmentId: appointment.id,
        deepLinkTab: 'appointments',
        movedByUserId: mover.id,
      },
      deliverExternal: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.warn(
      `Reschedule notification failed for appointment=${appointment.id}: ${message}`,
    );
  }
}
