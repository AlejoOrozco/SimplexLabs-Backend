import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import {
  appointmentInclude,
  toAppointmentResponse,
} from './appointment.mapper';

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

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
      { contactId: dto.contactId, productId: dto.productId },
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

    if (dto.contactId !== undefined || dto.productId !== undefined) {
      await this.assertOptionalReferencesBelongToCompany(
        {
          contactId: dto.contactId,
          productId: dto.productId,
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

  // ---------- private helpers ----------

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
   * Prevents an appointment from referencing a contact or product that
   * belongs to a different tenant. DB foreign keys alone won't catch this.
   */
  private async assertOptionalReferencesBelongToCompany(
    refs: { contactId?: string; productId?: string },
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
  }
}
