import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CompanyResponseDto } from './dto/company-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

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

  async create(dto: CreateCompanyDto): Promise<CompanyResponseDto> {
    return this.prisma.company.create({
      data: dto,
      select: companySelect,
    });
  }

  async update(
    id: string,
    dto: UpdateCompanyDto,
    user: AuthenticatedUser,
  ): Promise<CompanyResponseDto> {
    await this.findOne(id, user);

    return this.prisma.company.update({
      where: { id },
      data: dto,
      select: companySelect,
    });
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    try {
      await this.prisma.company.delete({ where: { id } });
      return { deleted: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`Company ${id} not found`);
      }
      throw err;
    }
  }

  private assertAccess(companyId: string, user: AuthenticatedUser): void {
    if (user.role === 'SUPER_ADMIN') return;
    if (user.companyId !== companyId) {
      throw new ForbiddenException('Access denied to this company');
    }
  }
}
