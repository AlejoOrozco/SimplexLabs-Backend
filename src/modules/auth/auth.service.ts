import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';

type SupabaseAdminClient = ReturnType<typeof createClient>;
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthUserDto } from './dto/auth-response.dto';
import type { AuthenticatedUserRole } from '../../common/decorators/current-user.decorator';

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
  role: AuthenticatedUserRole;
  companyId: string | null;
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
    private readonly config: ConfigService,
  ) {
    const url = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    if (!url || !serviceRoleKey) {
      throw new Error(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }
    this.supabase = createClient(url, serviceRoleKey);
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
        role: true,
        companyId: true,
        isActive: true,
      },
    });

    if (!dbUser || !dbUser.isActive) {
      throw new UnauthorizedException('Account not found or inactive');
    }

    return {
      user: this.toAuthUser(dbUser),
      tokens: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      },
    };
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Email already in use');
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

    let dbUser: PersistedUser;
    try {
      dbUser = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { name: dto.companyName, niche: dto.niche },
          select: { id: true },
        });

        return tx.user.create({
          data: {
            supabaseId: supabaseUserId,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: 'CLIENT',
            companyId: company.id,
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            companyId: true,
          },
        });
      });
    } catch (err) {
      await this.safeDeleteSupabaseUser(supabaseUserId);
      throw err;
    }

    const { data: sessionData, error: signInErr } =
      await this.supabase.auth.signInWithPassword({
        email: dto.email,
        password: dto.password,
      });

    if (signInErr || !sessionData.session) {
      await this.rollbackRegistration(
        supabaseUserId,
        dbUser.id,
        dbUser.companyId,
      );
      throw new InternalServerErrorException(
        'Failed to create session after registration',
      );
    }

    return {
      user: this.toAuthUser(dbUser),
      tokens: {
        accessToken: sessionData.session.access_token,
        refreshToken: sessionData.session.refresh_token,
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

  getOAuthUrl(provider: 'google'): string {
    const supabaseUrl = this.config.get<string>('supabase.url') ?? '';
    // Use the primary (first) configured frontend URL as the OAuth redirect target.
    const frontendUrls = this.config.get<string[]>('frontendUrls') ?? [];
    const frontendUrl = frontendUrls[0] ?? '';
    const redirect = encodeURIComponent(`${frontendUrl}/auth/callback`);
    return `${supabaseUrl}/auth/v1/authorize?provider=${provider}&redirect_to=${redirect}`;
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
        role: true,
        companyId: true,
        isActive: true,
      },
    });

    if (existing) {
      if (!existing.isActive) {
        throw new UnauthorizedException('Account is inactive');
      }
      return {
        user: this.toAuthUser(existing),
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

      return tx.user.create({
        data: {
          supabaseId: supabaseUser.id,
          email,
          firstName,
          lastName,
          role: 'CLIENT',
          companyId: company.id,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          companyId: true,
        },
      });
    });

    return {
      user: this.toAuthUser(created),
      tokens: { accessToken },
    };
  }

  private toAuthUser(user: PersistedUser): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
    };
  }

  private async safeDeleteSupabaseUser(supabaseUserId: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(supabaseUserId);
    if (error) {
      this.logger.error(
        `Failed to rollback Supabase user ${supabaseUserId}: ${error.message}`,
      );
    }
  }

  private async rollbackRegistration(
    supabaseUserId: string,
    userId: string,
    companyId: string | null,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.delete({ where: { id: userId } });
        if (companyId) {
          await tx.company.delete({ where: { id: companyId } });
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(
        `Failed to rollback DB records for user ${userId}: ${message}`,
      );
    }
    await this.safeDeleteSupabaseUser(supabaseUserId);
  }
}
