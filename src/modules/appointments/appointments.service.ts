import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppointmentStatus,
  AppointmentType,
  Channel,
  ConversationLifecycleStatus,
  ConvoStatus,
  NotificationType,
  Prisma,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { MarkCallbackHandledDto } from './dto/mark-callback-handled.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendeesService } from '../attendees/attendees.service';
import { isPlatformSuperAdmin } from '../../common/auth/user-role.util';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import {
  appointmentInclude,
  toAppointmentResponse,
  type AppointmentWithRelations,
} from './appointment.mapper';
import { WhatsAppSenderService } from '../webhooks/whatsapp-sender.service';
import { ConversationLifecycleService } from '../conversations/conversation-lifecycle.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  messageEventSelect,
  toMessageEventPayload,
} from '../realtime/realtime-payload.mapper';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappSender: WhatsAppSenderService,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly attendeesService: AttendeesService,
  ) {}

  async findAll(
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto[]> {
    const companyScope = scopedCompanyWhere(requester);
    const rows = await this.prisma.appointment.findMany({
      where: {
        OR: [
          companyScope,
          { organizerId: requester.id },
          {
            appointment_attendees: {
              some: { user_id: requester.id },
            },
          },
        ],
      },
      include: appointmentInclude,
      orderBy: { scheduledAt: 'asc' },
    });
    return rows.map(toAppointmentResponse);
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    const row = await this.loadOrThrow(id, requester);
    return toAppointmentResponse(row);
  }

  async create(
    dto: CreateAppointmentDto,
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    const companyId =
      requester.roleName === 'SUPER_ADMIN'
        ? resolveCompanyId(requester, dto.companyId)
        : requester.companyId;

    if (!companyId) {
      throw new ForbiddenException(
        'Only users scoped to a company can create appointments',
      );
    }

    await this.assertOptionalReferencesBelongToCompany(
      {
        contactId: dto.contactId,
        productId: dto.productId,
        staffId: dto.staffId,
      },
      companyId,
    );

    const requesterTz = await this.prisma.user.findUnique({
      where: { id: requester.id },
      select: { timezone: true },
    });

    const creatorTimezone =
      dto.creatorTimezone ??
      requesterTz?.timezone ??
      'America/Bogota';

    const row = await this.prisma.appointment.create({
      data: {
        companyId,
        organizerId: requester.id,
        title: dto.title,
        description: dto.description ?? null,
        type: dto.type,
        scheduledAt: new Date(dto.scheduledAt),
        durationMinutes: dto.durationMinutes ?? 30,
        contactId: dto.contactId ?? null,
        productId: dto.productId ?? null,
        staffId: dto.staffId ?? null,
        meetingUrl: dto.meetingUrl ?? null,
        externalAttendeeName: dto.externalAttendeeName ?? null,
        externalAttendeeEmail: dto.externalAttendeeEmail ?? null,
        creatorTimezone,
        ...(dto.isRecurring !== undefined
          ? { isRecurring: dto.isRecurring }
          : {}),
        ...(dto.recurrenceRule !== undefined
          ? { recurrenceRule: dto.recurrenceRule }
          : {}),
        ...(dto.recurrenceParentId !== undefined
          ? { recurrenceParentId: dto.recurrenceParentId }
          : {}),
        ...(dto.recurrenceEndDate !== undefined
          ? {
              recurrenceEndDate: dto.recurrenceEndDate
                ? new Date(dto.recurrenceEndDate)
                : null,
            }
          : {}),
      },
      include: appointmentInclude,
    });

    await this.syncAttendeesIfProvided(row, dto, requester);

    return toAppointmentResponse(row);
  }

  /**
   * Confirm a PENDING appointment.
   *
   * Side effects:
   *   1. Status → CONFIRMED (atomic updateMany from PENDING only).
   *   2. Linked conversation lifecycle → APPOINTMENT_BOOKED.
   *   3. Best-effort WhatsApp confirmation to the contact, if a channel +
   *      phone + open conversation exist. The outbound message is persisted
   *      with senderType = AGENT and surfaced via realtime.
   */
  async confirm(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.loadOrThrow(id, requester);

    this.assertConfirmable(existing.status);

    // Compare-and-swap: only flip PENDING → CONFIRMED. Guards against
    // double-clicks and concurrent rejection.
    const flipped = await this.prisma.appointment.updateMany({
      where: { id, status: AppointmentStatus.PENDING },
      data: { status: AppointmentStatus.CONFIRMED },
    });
    if (flipped.count === 0) {
      throw new ConflictException(
        'Appointment is no longer pending (may have been confirmed or cancelled already).',
      );
    }

    // Lifecycle follow-up on the open conversation that spawned this.
    await this.updateLifecycleForContact(
      existing.companyId,
      existing.contactId,
      ConversationLifecycleStatus.APPOINTMENT_BOOKED,
    );

    await this.sendCustomerConfirmation(existing);

    const refreshed = await this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      include: appointmentInclude,
    });
    return toAppointmentResponse(refreshed);
  }

  /**
   * Client requests a phone callback instead of confirming the proposed slot
   * (SimplexLabs ↔ client meetings only).
   */
  async requestCallback(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ requested: true }> {
    if (requester.roleName !== 'CLIENT') {
      throw new ForbiddenException(
        'Only client portal users can request a callback.',
      );
    }

    const row = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        company: { select: { id: true, name: true } },
      },
    });
    if (!row) {
      throw new NotFoundException(`Appointment ${id} not found`);
    }
    assertTenantAccess(row.companyId, requester);

    if (row.type !== AppointmentType.SIMPLEX_WITH_CLIENT) {
      throw new BadRequestException(
        'Callbacks are only available for SimplexLabs ↔ client appointments.',
      );
    }
    if (row.status !== AppointmentStatus.PENDING) {
      throw new ConflictException(
        'A callback can only be requested while the appointment is still pending.',
      );
    }

    if (row.callMeAsap) {
      return { requested: true };
    }

    await this.prisma.appointment.update({
      where: { id },
      data: {
        callMeAsap: true,
        callMeAsapRequestedAt: new Date(),
      },
    });

    try {
      await this.notifications.create({
        companyId: row.companyId,
        type: NotificationType.APPOINTMENT_CALLBACK_REQUESTED,
        title: 'Callback requested',
        body: `${row.company.name} requested a callback for "${row.title}".`,
        payload: {
          appointmentId: row.id,
          deepLinkTab: 'appointments',
        },
        deliverExternal: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(
        `Callback notification failed for appointment=${id}: ${message}`,
      );
    }

    return { requested: true };
  }

  /**
   * SimplexLabs operator marks that the client callback was completed.
   */
  async markCallbackHandled(
    id: string,
    dto: MarkCallbackHandledDto,
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    if (!isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany)) {
      throw new ForbiddenException(
        'Only platform operators may mark callbacks as handled.',
      );
    }

    const existing = await this.prisma.appointment.findUnique({
      where: { id },
      include: appointmentInclude,
    });
    if (!existing) {
      throw new NotFoundException(`Appointment ${id} not found`);
    }
    if (!existing.callMeAsapRequestedAt) {
      throw new BadRequestException(
        'No callback was requested for this appointment.',
      );
    }
    if (existing.callMeAsapHandledAt) {
      return toAppointmentResponse(existing);
    }

    const row = await this.prisma.appointment.update({
      where: { id },
      data: {
        callMeAsapHandledAt: new Date(),
        callMeAsapHandledBy: requester.id,
        ...(dto.notes !== undefined
          ? { callMeAsapHandlerNotes: dto.notes }
          : {}),
      },
      include: appointmentInclude,
    });
    return toAppointmentResponse(row);
  }

  // ---------------------------------------------------------------------------
  // private helpers
  // ---------------------------------------------------------------------------

  private assertConfirmable(status: AppointmentStatus): void {
    switch (status) {
      case AppointmentStatus.PENDING:
        return;
      case AppointmentStatus.CONFIRMED:
        throw new ConflictException('Appointment is already confirmed.');
      case AppointmentStatus.CANCELLED:
        throw new ConflictException('Cannot confirm a cancelled appointment.');
      case AppointmentStatus.COMPLETED:
        throw new ConflictException('Cannot confirm a completed appointment.');
      default:
        throw new BadRequestException(`Unknown status: ${String(status)}`);
    }
  }

  /**
   * Walk the contact's most recent open conversation and transition its
   * lifecycle status (no-op if contact / conversation absent).
   */
  private async updateLifecycleForContact(
    companyId: string,
    contactId: string | null,
    next: ConversationLifecycleStatus,
  ): Promise<void> {
    if (!contactId) return;
    const convo = await this.prisma.conversation.findFirst({
      where: { companyId, contactId, status: ConvoStatus.OPEN },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (convo) {
      await this.lifecycle.transition(convo.id, next);
    }
  }

  private async sendCustomerConfirmation(appt: {
    id: string;
    companyId: string;
    contactId: string | null;
    scheduledAt: Date;
    durationMinutes: number;
    title: string;
  }): Promise<void> {
    if (!appt.contactId) {
      this.logger.warn(
        `Appointment ${appt.id} confirmed but has no contact; skipping customer WhatsApp.`,
      );
      return;
    }

    const contact = await this.prisma.clientContact.findUnique({
      where: { id: appt.contactId },
      select: { phone: true },
    });
    if (!contact?.phone) {
      this.logger.warn(
        `Contact ${appt.contactId} has no phone; cannot send WhatsApp confirmation.`,
      );
      return;
    }

    const convo = await this.prisma.conversation.findFirst({
      where: {
        companyId: appt.companyId,
        contactId: appt.contactId,
        channel: Channel.WHATSAPP,
        status: ConvoStatus.OPEN,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!convo) {
      this.logger.warn(
        `No open WhatsApp conversation for contact ${appt.contactId}; sending without persistence.`,
      );
    }

    const iso = appt.scheduledAt.toISOString();
    const body =
      `Your appointment has been confirmed: ${appt.title}\n` +
      `When: ${iso} (UTC)\n` +
      `Duration: ${appt.durationMinutes} minutes\n` +
      `Reply to this message if you need to reschedule.`;

    try {
      await this.whatsappSender.sendTextMessage({
        companyId: appt.companyId,
        recipientPhone: contact.phone,
        text: body,
      });
    } catch (error) {
      this.logger.error(
        `Failed to send WhatsApp confirmation for appointment=${appt.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (!convo) return;

    const now = new Date();
    const created = await this.prisma.message.create({
      data: {
        conversationId: convo.id,
        senderType: SenderType.AGENT,
        content: body,
        sentAt: now,
        metadata: {
          source: 'appointment-confirmation',
          appointmentId: appt.id,
        } satisfies Prisma.InputJsonValue,
      },
      select: messageEventSelect,
    });
    await this.prisma.conversation.update({
      where: { id: convo.id },
      data: { lastAgentMessageAt: now, updatedAt: now },
      select: { id: true },
    });
    this.realtime.emitMessageCreated(toMessageEventPayload(created));
  }

  private async loadOrThrow(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<
    Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>
  > {
    const row = await this.prisma.appointment.findUnique({
      where: { id },
      include: appointmentInclude,
    });
    if (!row) {
      throw new NotFoundException(`Appointment ${id} not found`);
    }
    await this.assertCanAccessAppointment(row, requester);
    return row;
  }

  private async assertCanAccessAppointment(
    row: { id: string; companyId: string; organizerId: string },
    requester: AuthenticatedUser,
  ): Promise<void> {
    try {
      assertTenantAccess(row.companyId, requester);
      return;
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        throw err;
      }
    }

    if (row.organizerId === requester.id || isPlatformSuperAdmin(requester)) {
      return;
    }

    const isAttendee = await this.prisma.appointment_attendees.findFirst({
      where: { appointment_id: row.id, user_id: requester.id },
      select: { id: true },
    });
    if (isAttendee) {
      return;
    }

    throw new ForbiddenException('Access denied');
  }

  /**
   * Prevents an appointment from referencing a contact, product or staff
   * that belongs to a different tenant. DB foreign keys alone won't catch this.
   */
  private async assertOptionalReferencesBelongToCompany(
    refs: { contactId?: string; productId?: string; staffId?: string },
    companyId: string,
  ): Promise<void> {
    if (refs.contactId) {
      const contact = await this.prisma.clientContact.findUnique({
        where: { id: refs.contactId },
        select: { companyId: true },
      });
      if (!contact) {
        throw new NotFoundException(`Contact ${refs.contactId} not found`);
      }
      if (contact.companyId !== companyId) {
        throw new ForbiddenException('Contact does not belong to your company');
      }
    }

    if (refs.productId) {
      const product = await this.prisma.product.findUnique({
        where: { id: refs.productId },
        select: { companyId: true },
      });
      if (!product) {
        throw new NotFoundException(`Product ${refs.productId} not found`);
      }
      if (product.companyId !== companyId) {
        throw new ForbiddenException('Product does not belong to your company');
      }
    }

    if (refs.staffId) {
      const staff = await this.prisma.staff.findUnique({
        where: { id: refs.staffId },
        select: { companyId: true, isActive: true },
      });
      if (!staff) {
        throw new NotFoundException(`Staff ${refs.staffId} not found`);
      }
      if (staff.companyId !== companyId) {
        throw new ForbiddenException('Staff does not belong to your company');
      }
      if (!staff.isActive) {
        throw new BadRequestException(
          `Staff ${refs.staffId} is deactivated; cannot assign.`,
        );
      }
    }
  }

  private async syncAttendeesIfProvided(
    row: AppointmentWithRelations,
    dto: Pick<CreateAppointmentDto, 'attendeeUserIds' | 'attendeeContactIds'>,
    requester: AuthenticatedUser,
  ): Promise<void> {
    if (
      dto.attendeeUserIds === undefined &&
      dto.attendeeContactIds === undefined
    ) {
      return;
    }

    await this.attendeesService.syncAttendees(
      row.id,
      {
        title: row.title,
        companyId: row.companyId,
        organizerId: row.organizerId,
      },
      {
        userIds: dto.attendeeUserIds,
        contactIds: dto.attendeeContactIds,
      },
      requester,
    );
  }
}
