import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isSuperAdmin } from '../../common/auth/user-role.util';
import { NotificationsService } from '../notifications/notifications.service';
import { assertCanInviteAttendeeUser } from './attendee-invite.policy';
import type { AttendeeResponseDto } from './dto/attendee-response.dto';

export interface SyncAppointmentAttendeesInput {
  userIds?: string[];
  contactIds?: string[];
}

@Injectable()
export class AttendeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Syncs invited users/contacts on create or update (organizer-only).
   * Omit a field to leave that side unchanged (update only).
   */
  async syncAttendees(
    appointmentId: string,
    appointment: { title: string; companyId: string; organizerId: string },
    input: SyncAppointmentAttendeesInput,
    requester: AuthenticatedUser,
  ): Promise<void> {
    if (appointment.organizerId !== requester.id) {
      throw new ForbiddenException('Only the organizer can manage attendees');
    }

    if (input.userIds !== undefined) {
      await this.syncUserAttendees(
        appointmentId,
        appointment,
        input.userIds,
        requester,
      );
    }

    if (input.contactIds !== undefined) {
      await this.syncContactAttendees(
        appointmentId,
        appointment.companyId,
        input.contactIds,
      );
    }
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

  private async syncUserAttendees(
    appointmentId: string,
    appointment: { title: string; companyId: string; organizerId: string },
    userIds: string[],
    requester: AuthenticatedUser,
  ): Promise<void> {
    const desiredIds = [
      ...new Set(userIds.filter((id) => id !== appointment.organizerId)),
    ];

    const users =
      desiredIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: desiredIds }, isActive: true },
            select: {
              id: true,
              companyId: true,
              role_name: true,
              company: { select: { is_platform_owner: true } },
            },
          });

    if (users.length !== desiredIds.length) {
      const found = new Set(users.map((u) => u.id));
      const missing = desiredIds.filter((id) => !found.has(id));
      throw new NotFoundException(
        `User(s) not found or inactive: ${missing.join(', ')}`,
      );
    }

    for (const user of users) {
      assertCanInviteAttendeeUser(
        requester,
        {
          id: user.id,
          roleName: user.role_name,
          companyId: user.companyId,
          isPlatformOwnerCompany: user.company?.is_platform_owner === true,
        },
        appointment.companyId,
      );
    }

    const existing = await this.prisma.appointment_attendees.findMany({
      where: { appointment_id: appointmentId, user_id: { not: null } },
      select: { id: true, user_id: true },
    });

    const existingUserIds = new Set(
      existing
        .map((row) => row.user_id)
        .filter((id): id is string => id !== null),
    );
    const desiredSet = new Set(desiredIds);

    const toRemove = existing.filter(
      (row) => row.user_id !== null && !desiredSet.has(row.user_id),
    );
    if (toRemove.length > 0) {
      await this.prisma.appointment_attendees.deleteMany({
        where: { id: { in: toRemove.map((row) => row.id) } },
      });
    }

    const newlyAdded = users.filter((u) => !existingUserIds.has(u.id));
    if (newlyAdded.length > 0) {
      await this.prisma.appointment_attendees.createMany({
        data: newlyAdded.map((user) => ({
          appointment_id: appointmentId,
          user_id: user.id,
          invitation_status: 'PENDING',
        })),
        skipDuplicates: true,
      });

      await Promise.all(
        newlyAdded.map((invited) =>
          this.notificationsService.create({
            companyId: invited.companyId ?? appointment.companyId,
            type: NotificationType.APPOINTMENT_REQUESTED,
            title: 'Meeting invitation',
            body: `You have been invited to "${appointment.title}"`,
            payload: {
              appointmentId,
              kind: 'appointment_invite',
              recipientUserId: invited.id,
            },
            deliverExternal: false,
          }),
        ),
      );
    }
  }

  private async syncContactAttendees(
    appointmentId: string,
    companyId: string,
    contactIds: string[],
  ): Promise<void> {
    const desiredIds = [...new Set(contactIds)];

    if (desiredIds.length > 0) {
      const contacts = await this.prisma.clientContact.findMany({
        where: { id: { in: desiredIds } },
        select: { id: true, companyId: true },
      });

      if (contacts.length !== desiredIds.length) {
        const found = new Set(contacts.map((c) => c.id));
        const missing = desiredIds.filter((id) => !found.has(id));
        throw new NotFoundException(`Contact(s) not found: ${missing.join(', ')}`);
      }

      for (const contact of contacts) {
        if (contact.companyId !== companyId) {
          throw new ForbiddenException(
            `Contact ${contact.id} does not belong to this company`,
          );
        }
      }
    }

    const existing = await this.prisma.appointment_attendees.findMany({
      where: { appointment_id: appointmentId, contact_id: { not: null } },
      select: { id: true, contact_id: true },
    });

    const existingContactIds = new Set(
      existing
        .map((row) => row.contact_id)
        .filter((id): id is string => id !== null),
    );
    const desiredSet = new Set(desiredIds);

    const toRemove = existing.filter(
      (row) => row.contact_id !== null && !desiredSet.has(row.contact_id),
    );
    if (toRemove.length > 0) {
      await this.prisma.appointment_attendees.deleteMany({
        where: { id: { in: toRemove.map((row) => row.id) } },
      });
    }

    const toAdd = desiredIds.filter((id) => !existingContactIds.has(id));
    if (toAdd.length > 0) {
      await this.prisma.appointment_attendees.createMany({
        data: toAdd.map((contactId) => ({
          appointment_id: appointmentId,
          contact_id: contactId,
          invitation_status: 'PENDING',
        })),
        skipDuplicates: true,
      });
    }
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
