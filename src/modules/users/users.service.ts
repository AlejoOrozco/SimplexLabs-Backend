import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SupabaseAdminClient } from '../../common/supabase/supabase-admin.service';
import { SupabaseAdminService } from '../../common/supabase/supabase-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  isCompanyAdmin,
  isPlatformPrivilegedRole,
  isPlatformSuperAdmin,
  TENANT_CREATABLE_ROLES,
} from '../../common/auth/user-role.util';

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role_name: true,
  isActive: true,
  firstLoginCompleted: true,
  companyId: true,
  timezone: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly supabase: SupabaseAdminClient;

  constructor(
    private readonly prisma: PrismaService,
    supabaseAdmin: SupabaseAdminService,
  ) {
    this.supabase = supabaseAdmin.getClient();
  }

  async findAll(requester: AuthenticatedUser): Promise<UserResponseDto[]> {
    const where: Prisma.UserWhereInput = isPlatformSuperAdmin(
      requester,
      requester.isPlatformOwnerCompany,
    )
      ? {}
      : (() => {
          if (!requester.companyId) {
            throw new ForbiddenException('Requester has no company scope');
          }
          return { companyId: requester.companyId };
        })();

    const rows = await this.prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toUserResponse(row));
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userSelect,
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    this.assertAccess(user.companyId, requester);
    return this.toUserResponse(user);
  }

  async create(
    dto: CreateUserDto,
    requester: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    const companyId = this.resolveCreateCompanyId(dto, requester);
    this.assertAllowedCreateRole(dto.roleName, requester);

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const roleRow = await this.prisma.roles.findUnique({
      where: { name: dto.roleName },
      select: { name: true },
    });
    if (!roleRow) {
      throw new BadRequestException(`Unknown role: ${dto.roleName}`);
    }

    if (dto.roleName === 'SUPER_ADMIN' && companyId) {
      await this.assertPlatformOwnerCompany(companyId);
    }

    const { data: created, error: createErr } =
      await this.supabase.auth.admin.createUser({
        email: dto.email,
        password: dto.password,
        email_confirm: true,
      });

    if (createErr || !created.user) {
      this.logger.error(
        `Supabase createUser failed for ${dto.email}`,
        createErr?.message,
      );
      throw new InternalServerErrorException('Failed to create auth account');
    }

    const supabaseUserId = created.user.id;

    try {
      const created = await this.prisma.user.create({
        data: {
          supabaseId: supabaseUserId,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role_name: dto.roleName,
          companyId,
        },
        select: userSelect,
      });
      return this.toUserResponse(created);
    } catch (err) {
      await this.safeDeleteSupabaseUser(supabaseUserId);
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    requester: AuthenticatedUser,
  ): Promise<UserResponseDto> {
    await this.findOne(id, requester);

    const updated = await this.prisma.user.update({
      where: { id },
      data: dto,
      select: userSelect,
    });
    return this.toUserResponse(updated);
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true, companyId: true, role_name: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    this.assertCanDeactivateUser(user, requester);

    if (!user.isActive) {
      return { deleted: true };
    }

    await this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  async completeFirstLogin(userId: string): Promise<UserResponseDto> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { firstLoginCompleted: true },
      select: userSelect,
    });
    return this.toUserResponse(updated);
  }

  private toUserResponse(row: UserRow): UserResponseDto {
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      roleName: row.role_name,
      isActive: row.isActive,
      firstLoginCompleted: row.firstLoginCompleted,
      companyId: row.companyId,
      timezone: row.timezone,
      createdAt: row.createdAt,
    };
  }

  private assertAccess(
    targetCompanyId: string | null,
    requester: AuthenticatedUser,
  ): void {
    if (isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany)) {
      return;
    }
    if (targetCompanyId !== requester.companyId) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async assertPlatformOwnerCompany(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { is_platform_owner: true },
    });
    if (!company?.is_platform_owner) {
      throw new BadRequestException(
        'SUPER_ADMIN users can only belong to the platform owner company',
      );
    }
  }

  private resolveCreateCompanyId(
    dto: CreateUserDto,
    requester: AuthenticatedUser,
  ): string | null {
    if (isCompanyAdmin(requester)) {
      if (!requester.companyId) {
        throw new ForbiddenException('Requester has no company scope');
      }
      if (dto.companyId && dto.companyId !== requester.companyId) {
        throw new ForbiddenException(
          'You can only create users in your own company',
        );
      }
      return requester.companyId;
    }

    if (isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany)) {
      if (dto.roleName === 'SUPER_ADMIN') {
        if (!dto.companyId) {
          throw new BadRequestException(
            'SUPER_ADMIN users must belong to the platform owner company',
          );
        }
        return dto.companyId;
      }
      if (dto.roleName === 'CLIENT' && !dto.companyId) {
        throw new ForbiddenException('CLIENT users require a companyId');
      }
      return dto.companyId ?? null;
    }

    throw new ForbiddenException('You cannot create users');
  }

  private assertAllowedCreateRole(
    roleName: string,
    requester: AuthenticatedUser,
  ): void {
    if (isCompanyAdmin(requester)) {
      if (
        !TENANT_CREATABLE_ROLES.includes(
          roleName as (typeof TENANT_CREATABLE_ROLES)[number],
        )
      ) {
        throw new ForbiddenException('You cannot assign this role');
      }
      return;
    }

    if (isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany)) {
      if (roleName === 'SUPER_ADMIN') {
        return;
      }
      if (isPlatformPrivilegedRole(roleName) && roleName !== 'SUPER_ADMIN') {
        return;
      }
      if (
        TENANT_CREATABLE_ROLES.includes(
          roleName as (typeof TENANT_CREATABLE_ROLES)[number],
        ) ||
        roleName === 'CLIENT'
      ) {
        return;
      }
    }

    throw new ForbiddenException('You cannot assign this role');
  }

  private assertCanDeactivateUser(
    target: { companyId: string | null; role_name: string },
    requester: AuthenticatedUser,
  ): void {
    if (target.role_name === 'SUPER_ADMIN') {
      throw new ForbiddenException('Cannot deactivate a Super Administrator');
    }

    if (isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany)) {
      return;
    }

    if (isCompanyAdmin(requester)) {
      if (target.companyId !== requester.companyId) {
        throw new ForbiddenException('Access denied');
      }
      if (target.role_name === 'COMPANY_ADMIN') {
        throw new ForbiddenException('Cannot deactivate a company administrator');
      }
      return;
    }

    throw new ForbiddenException('You cannot deactivate users');
  }

  private async safeDeleteSupabaseUser(supabaseUserId: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(supabaseUserId);
    if (error) {
      this.logger.error(
        `Failed to delete Supabase user ${supabaseUserId}: ${error.message}`,
      );
    }
  }
}
