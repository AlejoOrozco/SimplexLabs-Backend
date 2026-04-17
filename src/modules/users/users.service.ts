import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

type SupabaseAdminClient = ReturnType<typeof createClient>;

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  companyId: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly supabase: SupabaseAdminClient;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const url = config.get<string>('supabase.url');
    const serviceRoleKey = config.get<string>('supabase.serviceRoleKey');
    if (!url || !serviceRoleKey) {
      throw new Error(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    this.supabase = createClient(url, serviceRoleKey);
  }

  async findAll(requester: AuthenticatedUser): Promise<UserResponseDto[]> {
    const where: Prisma.UserWhereInput =
      requester.role === 'SUPER_ADMIN'
        ? {}
        : { companyId: requester.companyId };

    if (requester.role !== 'SUPER_ADMIN' && !requester.companyId) {
      throw new ForbiddenException('Requester has no company scope');
    }

    return this.prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
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
    return user;
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

    if (dto.role === 'CLIENT' && !dto.companyId) {
      throw new ForbiddenException('CLIENT users require a companyId');
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
      return await this.prisma.user.create({
        data: {
          supabaseId: supabaseUserId,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role,
          companyId: dto.companyId ?? null,
        },
        select: userSelect,
      });
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

    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: userSelect,
    });
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    this.assertSuperAdmin(requester, 'delete user');

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { supabaseId: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    await this.safeDeleteSupabaseUser(user.supabaseId);

    try {
      await this.prisma.user.delete({ where: { id } });
      return { deleted: true };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(`User ${id} not found`);
      }
      throw err;
    }
  }

  private assertAccess(
    targetCompanyId: string | null,
    requester: AuthenticatedUser,
  ): void {
    if (requester.role === 'SUPER_ADMIN') return;
    if (targetCompanyId !== requester.companyId) {
      throw new ForbiddenException('Access denied');
    }
  }

  private assertSuperAdmin(requester: AuthenticatedUser, action: string): void {
    if (requester.role !== 'SUPER_ADMIN') {
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
