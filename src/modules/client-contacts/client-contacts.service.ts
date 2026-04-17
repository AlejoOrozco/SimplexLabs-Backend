import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientContactDto } from './dto/create-client-contact.dto';
import { UpdateClientContactDto } from './dto/update-client-contact.dto';
import { ClientContactResponseDto } from './dto/client-contact-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';

const contactSelect = {
  id: true,
  companyId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClientContactSelect;

@Injectable()
export class ClientContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    requester: AuthenticatedUser,
  ): Promise<ClientContactResponseDto[]> {
    return this.prisma.clientContact.findMany({
      where: scopedCompanyWhere(requester),
      select: contactSelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<ClientContactResponseDto> {
    const record = await this.prisma.clientContact.findUnique({
      where: { id },
      select: contactSelect,
    });
    if (!record) {
      throw new NotFoundException(`Contact ${id} not found`);
    }
    assertTenantAccess(record.companyId, requester);
    return record;
  }

  async create(
    dto: CreateClientContactDto,
    requester: AuthenticatedUser,
  ): Promise<ClientContactResponseDto> {
    const companyId = resolveCompanyId(requester, dto.companyId);

    try {
      return await this.prisma.clientContact.create({
        data: {
          companyId,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email ?? null,
          phone: dto.phone ?? null,
          source: dto.source,
        },
        select: contactSelect,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new NotFoundException(`Company ${companyId} not found`);
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateClientContactDto,
    requester: AuthenticatedUser,
  ): Promise<ClientContactResponseDto> {
    await this.findOne(id, requester);

    return this.prisma.clientContact.update({
      where: { id },
      data: dto,
      select: contactSelect,
    });
  }
}
