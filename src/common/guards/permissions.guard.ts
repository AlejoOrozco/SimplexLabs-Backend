import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PermissionsService } from '../../modules/permissions/permissions.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { isSuperAdmin } from '../auth/user-role.util';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

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

    if (isSuperAdmin(user)) {
      return true;
    }

    const granted = await this.permissionsService.resolvePermissions(user.id);
    const hasAll = required.every((p) => granted.includes(p));
    if (!hasAll) {
      throw new ForbiddenException(
        'You do not have the required permissions for this action',
      );
    }

    return true;
  }
}
