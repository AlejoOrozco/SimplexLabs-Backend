import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isSuperAdmin } from '../../common/auth/user-role.util';
import { NotificationsService } from '../notifications/notifications.service';
import type { AttendeeResponseDto } from './dto/attendee-response.dto';

@Injectable()
export class AttendeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async addAttendee(
    appointmentId: string,
    data: { userId?: string; contactId?: string },
    requester: AuthenticatedUser,
  ): Promise<AttendeeResponseDto> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        title: true,
        organizerId: true,
        companyId: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (appointment.organizerId !== requester.id) {
      throw new ForbiddenException('Only the organizer can add attendees');
    }

    if ((!data.userId && !data.contactId) || (data.userId && data.contactId)) {
      throw new BadRequestException(
        'Provide either userId or contactId, not both',
      );
    }

    const existingWhere =
      data.userId !== undefined
        ? { appointment_id: appointmentId, user_id: data.userId }
        : { appointment_id: appointmentId, contact_id: data.contactId! };

    const existing = await this.prisma.appointment_attendees.findFirst({
      where: existingWhere,
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('This person is already invited');
    }

    const row = await this.prisma.appointment_attendees.create({
      data: {
        appointment_id: appointmentId,
        user_id: data.userId ?? null,
        contact_id: data.contactId ?? null,
        invitation_status: 'PENDING',
      },
      select: {
        id: true,
        appointment_id: true,
        user_id: true,
        contact_id: true,
        invitation_status: true,
        responded_at: true,
      },
    });

    if (data.userId) {
      const invited = await this.prisma.user.findUnique({
        where: { id: data.userId },
        select: { companyId: true },
      });
      const companyId = invited?.companyId ?? appointment.companyId;
      await this.notificationsService.create({
        companyId,
        type: NotificationType.APPOINTMENT_REQUESTED,
        title: 'Meeting invitation',
        body: `You have been invited to "${appointment.title}"`,
        payload: { appointmentId, kind: 'appointment_invite' },
        deliverExternal: false,
      });
    }

    return this.mapAttendeeRow(row);
  }

  async respondToInvitation(
    appointmentId: string,
    response: 'ACCEPTED' | 'DECLINED',
    requester: AuthenticatedUser,
  ): Promise<AttendeeResponseDto> {
    const attendee = await this.prisma.appointment_attendees.findFirst({
      where: { appointment_id: appointmentId, user_id: requester.id },
      include: {
        appointments: {
          select: { title: true, organizerId: true, companyId: true },
        },
      },
    });

    if (!attendee) {
      throw new NotFoundException('You are not invited to this appointment');
    }

    const updated = await this.prisma.appointment_attendees.update({
      where: { id: attendee.id },
      data: {
        invitation_status: response,
        responded_at: new Date(),
      },
      select: {
        id: true,
        appointment_id: true,
        user_id: true,
        contact_id: true,
        invitation_status: true,
        responded_at: true,
      },
    });

    if (response === 'DECLINED') {
      await this.notificationsService.create({
        companyId: attendee.appointments.companyId,
        type: NotificationType.AGENT_NEEDS_ATTENTION,
        title: 'Invitation declined',
        body: `${requester.firstName} declined the invitation to "${attendee.appointments.title}"`,
        payload: {
          appointmentId,
          respondedBy: requester.id,
          kind: 'appointment_invite_declined',
        },
        deliverExternal: false,
      });
    }

    return this.mapAttendeeRow(updated);
  }

  async getAttendees(
    appointmentId: string,
    requester: AuthenticatedUser,
  ): Promise<AttendeeResponseDto[]> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { organizerId: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    const isOrganizer = appointment.organizerId === requester.id;
    const isAttendee = await this.prisma.appointment_attendees.findFirst({
      where: { appointment_id: appointmentId, user_id: requester.id },
      select: { id: true },
    });

    if (!isOrganizer && !isAttendee && !isSuperAdmin(requester)) {
      throw new ForbiddenException('You are not part of this appointment');
    }

    const rows = await this.prisma.appointment_attendees.findMany({
      where: { appointment_id: appointmentId },
      select: {
        id: true,
        appointment_id: true,
        user_id: true,
        contact_id: true,
        invitation_status: true,
        responded_at: true,
        users: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role_name: true,
            company: { select: { id: true, name: true } },
          },
        },
        client_contacts: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    });

    return rows.map((r) => this.mapAttendeeRow(r));
  }

  async removeAttendee(
    appointmentId: string,
    attendeeId: string,
    requester: AuthenticatedUser,
  ): Promise<{ removed: boolean }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { organizerId: true },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }
    if (appointment.organizerId !== requester.id) {
      throw new ForbiddenException('Only the organizer can remove attendees');
    }

    const result = await this.prisma.appointment_attendees.deleteMany({
      where: { id: attendeeId, appointment_id: appointmentId },
    });

    if (result.count === 0) {
      throw new NotFoundException('Attendee not found');
    }

    return { removed: true };
  }

  private mapAttendeeRow(
    row: {
      id: string;
      appointment_id: string;
      user_id: string | null;
      contact_id: string | null;
      invitation_status: string;
      responded_at: Date | null;
      users?: {
        id: string;
        firstName: string;
        lastName: string;
        email: string;
        role_name: string;
        company: { id: string; name: string } | null;
      } | null;
      client_contacts?: {
        id: string;
        firstName: string;
        lastName: string;
        phone: string | null;
        email: string | null;
        company: { id: string; name: string } | null;
      } | null;
    },
  ): AttendeeResponseDto {
    const base: AttendeeResponseDto = {
      id: row.id,
      appointmentId: row.appointment_id,
      userId: row.user_id,
      contactId: row.contact_id,
      invitationStatus: row.invitation_status,
      respondedAt: row.responded_at?.toISOString() ?? null,
    };

    if (row.users) {
      base.user = {
        id: row.users.id,
        firstName: row.users.firstName,
        lastName: row.users.lastName,
        email: row.users.email,
        roleName: row.users.role_name,
        ...(row.users.company
          ? { company: { id: row.users.company.id, name: row.users.company.name } }
          : {}),
      };
    }

    if (row.client_contacts) {
      base.contact = {
        id: row.client_contacts.id,
        firstName: row.client_contacts.firstName,
        lastName: row.client_contacts.lastName,
        phone: row.client_contacts.phone,
        email: row.client_contacts.email,
        ...(row.client_contacts.company
          ? {
              company: {
                id: row.client_contacts.company.id,
                name: row.client_contacts.company.name,
              },
            }
          : {}),
      };
    }

    return base;
  }
}
