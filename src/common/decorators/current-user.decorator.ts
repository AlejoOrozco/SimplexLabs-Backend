import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  supabaseId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** FK to `roles.name` — source of truth for RBAC. */
  roleName: string;
  companyId: string | null;
  isActive: boolean;
  isOwner: boolean;
  timezone: string;
  firstLoginCompleted: boolean;
  /** Resolved keys from `PermissionsService.resolvePermissions`. */
  permissions: string[];
  /** True when `companyId` points at the platform-owner tenant. */
  isPlatformOwnerCompany: boolean;
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
