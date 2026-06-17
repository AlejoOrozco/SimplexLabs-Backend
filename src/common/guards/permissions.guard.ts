import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { isCompanyPermissionKey } from '../auth/permission-keys';
import { isPlatformSuperAdmin } from '../auth/user-role.util';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (isPlatformSuperAdmin(user, user.isPlatformOwnerCompany)) {
      const platformOnly = required.every((p) => !isCompanyPermissionKey(p));
      if (platformOnly) {
        return true;
      }
    }

    const hasAll = required.every((p) => user.permissions.includes(p));
    if (!hasAll) {
      throw new ForbiddenException(
        'You do not have the required permissions for this action',
      );
    }

    return true;
  }
}
