import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/** Matches Prisma `Role` in `schema.prisma` — keep aligned when the enum changes. */
export type AuthenticatedUserRole = 'SUPER_ADMIN' | 'CLIENT';

export interface AuthenticatedUser {
  id: string;
  supabaseId: string;
  email: string;
  role: AuthenticatedUserRole;
  companyId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }
    return user;
  },
);
