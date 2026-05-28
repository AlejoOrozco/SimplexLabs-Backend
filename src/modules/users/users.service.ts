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
import { isSuperAdmin } from '../../common/auth/user-role.util';

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
    const where: Prisma.UserWhereInput = isSuperAdmin(requester)
      ? {}
      : { companyId: requester.companyId };

    if (!isSuperAdmin(requester) && !requester.companyId) {
      throw new ForbiddenException('Requester has no company scope');
    }

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
    this.assertSuperAdmin(requester, 'create user');

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    if (dto.roleName === 'CLIENT' && !dto.companyId) {
      throw new ForbiddenException('CLIENT users require a companyId');
    }

    const roleRow = await this.prisma.roles.findUnique({
      where: { name: dto.roleName },
      select: { name: true },
    });
    if (!roleRow) {
      throw new BadRequestException(`Unknown role: ${dto.roleName}`);
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
          companyId: dto.companyId ?? null,
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
    this.assertSuperAdmin(requester, 'delete user');

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

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
    if (isSuperAdmin(requester)) return;
    if (targetCompanyId !== requester.companyId) {
      throw new ForbiddenException('Access denied');
    }
  }

  private assertSuperAdmin(requester: AuthenticatedUser, action: string): void {
    if (!isSuperAdmin(requester)) {
      throw new ForbiddenException(`Only SUPER_ADMIN can ${action}`);
    }
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
