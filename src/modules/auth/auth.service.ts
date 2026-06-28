import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { SupabaseAdminClient } from '../../common/supabase/supabase-admin.service';
import { SupabaseAdminService } from '../../common/supabase/supabase-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentDefaultsService } from '../agents/bootstrap/agent-defaults.service';
import { LoginDto } from './dto/login.dto';
import { AuthUserDto } from './dto/auth-response.dto';
import { MeResponseDto } from './dto/me-response.dto';
import { ACCOUNT_DEACTIVATED } from '../../common/auth/account-deactivated';
import { PermissionsService } from '../permissions/permissions.service';

interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthResult {
  user: AuthUserDto;
  tokens: AuthTokens;
}

interface PersistedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role_name: string;
  companyId: string | null;
  is_owner: boolean;
}

function safeString(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly supabase: SupabaseAdminClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentDefaults: AgentDefaultsService,
    private readonly permissionsService: PermissionsService,
    supabaseAdmin: SupabaseAdminService,
  ) {
    this.supabase = supabaseAdmin.getClient();
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { supabaseId: data.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role_name: true,
        companyId: true,
        isActive: true,
        is_owner: true,
      },
    });

    if (!dbUser) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    if (!dbUser.isActive) {
      throw new UnauthorizedException(ACCOUNT_DEACTIVATED);
    }

    const permissions = await this.permissionsService.resolvePermissions(
      dbUser.id,
    );

    return {
      user: this.toAuthUser(
        {
          id: dbUser.id,
          email: dbUser.email,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          role_name: dbUser.role_name,
          companyId: dbUser.companyId,
          is_owner: dbUser.is_owner,
        },
        permissions,
      ),
      tokens: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    const { data, error } = await this.supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
    };
  }

  async logout(accessToken: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.signOut(accessToken);
    if (error) {
      this.logger.warn(`Supabase signOut returned error: ${error.message}`);
    }
  }

  async handleOAuthCallback(accessToken: string): Promise<AuthResult> {
    const { data, error } = await this.supabase.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid OAuth token');
    }

    const supabaseUser = data.user;
    const existing = await this.prisma.user.findUnique({
      where: { supabaseId: supabaseUser.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role_name: true,
        companyId: true,
        isActive: true,
        is_owner: true,
      },
    });

    if (existing) {
      if (!existing.isActive) {
        throw new UnauthorizedException(ACCOUNT_DEACTIVATED);
      }
      const permissions = await this.permissionsService.resolvePermissions(
        existing.id,
      );
      return {
        user: this.toAuthUser(
          {
            id: existing.id,
            email: existing.email,
            firstName: existing.firstName,
            lastName: existing.lastName,
            role_name: existing.role_name,
            companyId: existing.companyId,
            is_owner: existing.is_owner,
          },
          permissions,
        ),
        tokens: { accessToken },
      };
    }

    const email = supabaseUser.email ?? '';
    const emailLocalPart = email.split('@')[0];
    const fallbackName =
      emailLocalPart && emailLocalPart.length > 0 ? emailLocalPart : 'User';
    const firstName =
      safeString(supabaseUser.user_metadata, 'first_name') ?? fallbackName;
    const lastName = safeString(supabaseUser.user_metadata, 'last_name') ?? '';

    const created = await this.prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: `${fallbackName}'s Company`,
          niche: 'ENTREPRENEUR',
        },
        select: { id: true },
      });

      await tx.companySettings.create({
        data: { companyId: company.id },
        select: { id: true },
      });

      await this.agentDefaults.seedForCompany(company.id, { tx });

      return tx.user.create({
        data: {
          supabaseId: supabaseUser.id,
          email,
          firstName,
          lastName,
          role_name: 'CLIENT',
          companyId: company.id,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role_name: true,
          companyId: true,
          is_owner: true,
        },
      });
    });

    const permissions = await this.permissionsService.resolvePermissions(
      created.id,
    );

    return {
      user: this.toAuthUser(created, permissions),
      tokens: { accessToken },
    };
  }

  async completeFirstLogin(userId: string): Promise<MeResponseDto> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { firstLoginCompleted: true },
    });
    return this.getMe(userId);
  }

  async getMe(userId: string): Promise<MeResponseDto> {
    const [user, permissions] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          supabaseId: true,
          email: true,
          firstName: true,
          lastName: true,
          role_name: true,
          is_owner: true,
          companyId: true,
          isActive: true,
          timezone: true,
          firstLoginCompleted: true,
          company: {
            select: {
              id: true,
              name: true,
              niche: true,
              is_platform_owner: true,
            },
          },
        },
      }),
      this.permissionsService.resolvePermissions(userId),
    ]);

    return {
      id: user.id,
      supabaseId: user.supabaseId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleName: user.role_name,
      isOwner: user.is_owner,
      companyId: user.companyId,
      isActive: user.isActive,
      timezone: user.timezone,
      firstLoginCompleted: user.firstLoginCompleted,
      company: user.company
        ? {
            id: user.company.id,
            name: user.company.name,
            niche: user.company.niche,
            isPlatformOwner: user.company.is_platform_owner,
          }
        : null,
      permissions,
    };
  }

  private toAuthUser(user: PersistedUser, permissions: string[]): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleName: user.role_name,
      isOwner: user.is_owner,
      companyId: user.companyId,
      permissions,
    };
  }
}
