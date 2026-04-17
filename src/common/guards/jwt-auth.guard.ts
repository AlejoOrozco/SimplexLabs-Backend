import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { getCookieValue } from '../http/cookie.util';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { supabaseId: data.user.id },
      select: {
        id: true,
        supabaseId: true,
        email: true,
        role: true,
        companyId: true,
        isActive: true,
      },
    });

    if (!dbUser || !dbUser.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    const authenticated: AuthenticatedUser = {
      id: dbUser.id,
      supabaseId: dbUser.supabaseId,
      email: dbUser.email,
      role: dbUser.role,
      companyId: dbUser.companyId,
    };
    request.user = authenticated;
    return true;
  }
}
