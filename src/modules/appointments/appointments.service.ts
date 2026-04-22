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
  Channel,
  ConversationLifecycleStatus,
  ConvoStatus,
  Prisma,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { RejectAppointmentDto } from './dto/reject-appointment.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import {
  appointmentInclude,
  toAppointmentResponse,
} from './appointment.mapper';
import { MetaSenderService } from '../webhooks/meta-sender.service';
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
    private readonly metaSender: MetaSenderService,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly realtime: RealtimeService,
  ) {}

  async findAll(
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto[]> {
    const rows = await this.prisma.appointment.findMany({
      where: scopedCompanyWhere(requester),
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
    if (!requester.companyId) {
      throw new ForbiddenException(
        'Only users scoped to a company can create appointments',
      );
    }
    const companyId = requester.companyId;

    await this.assertOptionalReferencesBelongToCompany(
      {
        contactId: dto.contactId,
        productId: dto.productId,
        staffId: dto.staffId,
      },
      companyId,
    );

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
      },
      include: appointmentInclude,
    });
    return toAppointmentResponse(row);
  }

  async update(
    id: string,
    dto: UpdateAppointmentDto,
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.loadOrThrow(id, requester);

    if (
      dto.contactId !== undefined ||
      dto.productId !== undefined ||
      dto.staffId !== undefined
    ) {
      await this.assertOptionalReferencesBelongToCompany(
        {
          contactId: dto.contactId,
          productId: dto.productId,
          staffId: dto.staffId,
        },
        existing.companyId,
      );
    }

    const data: Prisma.AppointmentUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = new Date(dto.scheduledAt);
    }
    if (dto.durationMinutes !== undefined) {
      data.durationMinutes = dto.durationMinutes;
    }
    if (dto.meetingUrl !== undefined) data.meetingUrl = dto.meetingUrl;
    if (dto.externalAttendeeName !== undefined) {
      data.externalAttendeeName = dto.externalAttendeeName;
    }
    if (dto.externalAttendeeEmail !== undefined) {
      data.externalAttendeeEmail = dto.externalAttendeeEmail;
    }
    if (dto.contactId !== undefined) {
      data.contact = { connect: { id: dto.contactId } };
    }
    if (dto.productId !== undefined) {
      data.product = { connect: { id: dto.productId } };
    }
    if (dto.staffId !== undefined) {
      data.staff =
        dto.staffId === null
          ? { disconnect: true }
          : { connect: { id: dto.staffId } };
    }

    const row = await this.prisma.appointment.update({
      where: { id },
      data,
      include: appointmentInclude,
    });
    return toAppointmentResponse(row);
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    await this.loadOrThrow(id, requester);

    await this.prisma.appointment.delete({ where: { id } });
    return { deleted: true };
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
   * Reject / cancel an appointment (client-initiated).
   *
   * Side effects:
   *   1. Status → CANCELLED (from PENDING or CONFIRMED only).
   *   2. Linked conversation lifecycle rolled back to AGENT_REPLIED_WAITING
   *      so the agent can resume.
   *
   * No customer-facing message is sent in Phase 4 — the client decides what
   * to say manually via the takeover flow. Reason is logged internally.
   */
  async reject(
    id: string,
    dto: RejectAppointmentDto,
    requester: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    const existing = await this.loadOrThrow(id, requester);

    if (existing.status === AppointmentStatus.CANCELLED) {
      return toAppointmentResponse(existing);
    }
    if (existing.status === AppointmentStatus.COMPLETED) {
      throw new ConflictException(
        'Completed appointments cannot be cancelled.',
      );
    }

    const flipped = await this.prisma.appointment.updateMany({
      where: {
        id,
        status: {
          in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
        },
      },
      data: { status: AppointmentStatus.CANCELLED },
    });
    if (flipped.count === 0) {
      throw new ConflictException(
        'Appointment is no longer in a cancellable state.',
      );
    }

    this.logger.log(
      `Appointment rejected id=${id} by user=${requester.id} reason="${dto.reason ?? ''}"`,
    );

    await this.updateLifecycleForContact(
      existing.companyId,
      existing.contactId,
      ConversationLifecycleStatus.AGENT_REPLIED_WAITING,
    );

    const refreshed = await this.prisma.appointment.findUniqueOrThrow({
      where: { id },
      include: appointmentInclude,
    });
    return toAppointmentResponse(refreshed);
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
      await this.metaSender.sendWhatsappText(
        appt.companyId,
        contact.phone,
        body,
      );
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
    assertTenantAccess(row.companyId, requester);
    return row;
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
}
