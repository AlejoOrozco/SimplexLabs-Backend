import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CompanyResponseDto } from './dto/company-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isPlatformSuperAdmin } from '../../common/auth/user-role.util';
import {
  applyCompanyDeactivate,
  COMPANY_DEACTIVATED_BY_ADMIN_DELETE,
} from '../../common/company/company-lifecycle';

const companySelect = {
  id: true,
  name: true,
  niche: true,
  phone: true,
  address: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompanySelect;

@Injectable()
export class CompaniesService {
  private readonly logger = new Logger(CompaniesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<CompanyResponseDto[]> {
    return this.prisma.company.findMany({
      select: companySelect,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    user: AuthenticatedUser,
  ): Promise<CompanyResponseDto> {
    this.assertAccess(id, user);

    const company = await this.prisma.company.findUnique({
      where: { id },
      select: companySelect,
    });

    if (!company) {
      throw new NotFoundException(`Company ${id} not found`);
    }
    return company;
  }

  async update(
    id: string,
    dto: UpdateCompanyDto,
    user: AuthenticatedUser,
  ): Promise<CompanyResponseDto> {
    await this.findOne(id, user);

    const isPlatformAdmin = isPlatformSuperAdmin(
      user,
      user.isPlatformOwnerCompany,
    );

    if (
      isPlatformAdmin &&
      (dto.whatsappPhoneNumberId?.trim() || dto.whatsappPhoneNumber?.trim())
    ) {
      this.logger.log(
        'WhatsApp phone fields were provided; CompanyChannel rows still require a long-lived token via POST /channels.',
      );
    }

    const companyData: Prisma.CompanyUpdateInput = {};
    if (dto.name !== undefined) companyData.name = dto.name;
    if (dto.phone !== undefined) companyData.phone = dto.phone;
    if (dto.address !== undefined) companyData.address = dto.address;
    if (isPlatformAdmin && dto.niche !== undefined) {
      companyData.niche = dto.niche;
    }

    const settingsData: Prisma.CompanySettingsUpdateInput = {};
    if (dto.notificationEmail !== undefined) {
      settingsData.notificationEmail = dto.notificationEmail;
    }
    if (dto.notificationPhone !== undefined) {
      settingsData.notificationWhatsapp = dto.notificationPhone;
    }

    const hasCompanyPatch = Object.keys(companyData).length > 0;
    const hasSettingsPatch = Object.keys(settingsData).length > 0;

    if (!hasCompanyPatch && !hasSettingsPatch) {
      return this.findOne(id, user);
    }

    return this.prisma.$transaction(async (tx) => {
      if (hasCompanyPatch) {
        await tx.company.update({
          where: { id },
          data: companyData,
        });
      }
      if (hasSettingsPatch) {
        await tx.companySettings.upsert({
          where: { companyId: id },
          create: {
            companyId: id,
            notificationEmail:
              dto.notificationEmail !== undefined
                ? dto.notificationEmail
                : null,
            notificationWhatsapp:
              dto.notificationPhone !== undefined
                ? dto.notificationPhone
                : null,
          },
          update: settingsData,
        });
      }

      const company = await tx.company.findUnique({
        where: { id },
        select: companySelect,
      });
      if (!company) {
        throw new NotFoundException(`Company ${id} not found`);
      }
      return company;
    });
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });

    if (!company) {
      throw new NotFoundException(`Company ${id} not found`);
    }

    if (!company.isActive) {
      return { deleted: true };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { companyId: id, isActive: true },
        data: { isActive: false },
      });
      await applyCompanyDeactivate(
        tx,
        id,
        COMPANY_DEACTIVATED_BY_ADMIN_DELETE,
      );
    });

    return { deleted: true };
  }

  private assertAccess(companyId: string, user: AuthenticatedUser): void {
    if (isPlatformSuperAdmin(user, user.isPlatformOwnerCompany)) return;
    if (user.companyId !== companyId) {
      throw new ForbiddenException('Access denied to this company');
    }
  }
}
