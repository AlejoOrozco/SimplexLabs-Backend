import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionsService } from '../../modules/permissions/permissions.service';
import { SupabaseAdminService } from '../supabase/supabase-admin.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ACCOUNT_DEACTIVATED } from '../auth/account-deactivated';
import { getCookieValue } from '../http/cookie.util';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly permissionsService: PermissionsService,
    private readonly supabaseAdmin: SupabaseAdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = getCookieValue(request.cookies, 'access_token');

    if (!token) {
      throw new UnauthorizedException('No access token provided');
    }

    const supabaseUrl = this.config.get<string>('supabase.url');
    const serviceRoleKey = this.config.get<string>('supabase.serviceRoleKey');
    if (!supabaseUrl || !serviceRoleKey) {
      throw new UnauthorizedException('Authentication is not configured');
    }

    const { data, error } = await this.supabaseAdmin
      .getClient()
      .auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { supabaseId: data.user.id },
      select: {
        id: true,
        supabaseId: true,
        email: true,
        firstName: true,
        lastName: true,
        role_name: true,
        companyId: true,
        isActive: true,
        is_owner: true,
        timezone: true,
        firstLoginCompleted: true,
      },
    });

    if (!dbUser) {
      throw new UnauthorizedException('User not found or inactive');
    }

    if (!dbUser.isActive) {
      throw new UnauthorizedException(ACCOUNT_DEACTIVATED);
    }

    const permissions = await this.permissionsService.resolvePermissions(
      dbUser.id,
    );

    const authenticated: AuthenticatedUser = {
      id: dbUser.id,
      supabaseId: dbUser.supabaseId,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      roleName: dbUser.role_name,
      companyId: dbUser.companyId,
      isActive: dbUser.isActive,
      isOwner: dbUser.is_owner,
      timezone: dbUser.timezone,
      firstLoginCompleted: dbUser.firstLoginCompleted,
      permissions,
    };
    request.user = authenticated;
    return true;
  }
}
