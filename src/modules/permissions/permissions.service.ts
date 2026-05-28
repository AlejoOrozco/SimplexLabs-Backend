import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PERM } from '../../common/auth/permission-keys';
import type {
  UserPermissionManagementItem,
  UserPermissionsManagementResponse,
} from './permissions.types';

const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

const MANAGER_ROLES = new Set(['SUPER_ADMIN', 'COMPANY_ADMIN']);

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolved permission keys for a user: role defaults from `role_permissions`,
   * then per-user overrides from `user_permissions`.
   */
  async resolvePermissions(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role_name: true },
    });

    // `/auth/me` and the dashboard gate UI on this list. API routes still
    // enforce `@RequirePermissions`, where SUPER_ADMIN bypasses the guard.
    if (user.role_name === SUPER_ADMIN_ROLE) {
      return Object.values(PERM);
    }

    const rolePermissions = await this.prisma.role_permissions.findMany({
      where: { role_name: user.role_name },
      select: { permission_key: true, is_default_on: true },
    });

    const userOverrides = await this.prisma.user_permissions.findMany({
      where: { user_id: userId },
      select: { permission_key: true, is_granted: true },
    });

    const overrideMap = new Map(
      userOverrides.map((o) => [o.permission_key, o.is_granted]),
    );

    const granted: string[] = [];
    for (const rp of rolePermissions) {
      const override = overrideMap.get(rp.permission_key);
      const isGranted =
        override !== undefined ? override : rp.is_default_on;
      if (isGranted) granted.push(rp.permission_key);
    }

    return granted;
  }

  async assertPermission(
    userId: string,
    permissionKey: string,
  ): Promise<void> {
    const permissions = await this.resolvePermissions(userId);
    if (!permissions.includes(permissionKey)) {
      throw new ForbiddenException(
        `You do not have permission to perform this action (${permissionKey})`,
      );
    }
  }

  async hasPermission(
    userId: string,
    permissionKey: string,
  ): Promise<boolean> {
    const permissions = await this.resolvePermissions(userId);
    return permissions.includes(permissionKey);
  }

  async updateUserPermissions(
    targetUserId: string,
    updates: Array<{ permissionKey: string; isGranted: boolean }>,
    grantedById: string,
  ): Promise<void> {
    const granter = await this.prisma.user.findUniqueOrThrow({
      where: { id: grantedById },
      select: { role_name: true, companyId: true },
    });

    if (!MANAGER_ROLES.has(granter.role_name)) {
      throw new ForbiddenException('You cannot manage user permissions');
    }

    const target = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { role_name: true, companyId: true },
    });

    if (
      granter.role_name === 'COMPANY_ADMIN' &&
      target.companyId !== granter.companyId
    ) {
      throw new ForbiddenException(
        'You can only manage permissions within your own company',
      );
    }

    if (granter.role_name === 'COMPANY_ADMIN') {
      const granterPerms = await this.resolvePermissions(grantedById);
      for (const update of updates) {
        if (
          update.isGranted &&
          !granterPerms.includes(update.permissionKey)
        ) {
          throw new ForbiddenException(
            `You cannot grant a permission you do not have: ${update.permissionKey}`,
          );
        }
      }
    }

    const allowedKeys = new Set(
      (
        await this.prisma.role_permissions.findMany({
          where: { role_name: target.role_name },
          select: { permission_key: true },
        })
      ).map((r) => r.permission_key),
    );

    for (const update of updates) {
      if (!allowedKeys.has(update.permissionKey)) {
        throw new BadRequestException(
          `Permission is not defined for this user's role: ${update.permissionKey}`,
        );
      }
    }

    const grantedAt = new Date();
    await this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.user_permissions.upsert({
          where: {
            user_id_permission_key: {
              user_id: targetUserId,
              permission_key: update.permissionKey,
            },
          },
          update: {
            is_granted: update.isGranted,
            granted_by_id: grantedById,
            granted_at: grantedAt,
          },
          create: {
            user_id: targetUserId,
            permission_key: update.permissionKey,
            is_granted: update.isGranted,
            granted_by_id: grantedById,
            granted_at: grantedAt,
          },
        }),
      ),
    );
  }

  async updateUserRole(
    targetUserId: string,
    newRoleName: string,
    requesterId: string,
  ): Promise<void> {
    const requester = await this.prisma.user.findUniqueOrThrow({
      where: { id: requesterId },
      select: { role_name: true, companyId: true },
    });

    if (!MANAGER_ROLES.has(requester.role_name)) {
      throw new ForbiddenException('You cannot change user roles');
    }

    const target = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { role_name: true, companyId: true },
    });

    if (target.role_name === 'SUPER_ADMIN') {
      throw new BadRequestException(
        'Super Administrators cannot be demoted. Contact Alejandro to change this role.',
      );
    }

    if (requester.role_name === 'COMPANY_ADMIN') {
      if (target.companyId !== requester.companyId) {
        throw new ForbiddenException(
          'You can only manage roles within your own company',
        );
      }
      if (['SUPER_ADMIN', 'SIMPLEX_STAFF'].includes(newRoleName)) {
        throw new ForbiddenException('You cannot assign this role');
      }
    }

    const roleRow = await this.prisma.roles.findUnique({
      where: { name: newRoleName },
      select: { name: true },
    });
    if (!roleRow) {
      throw new BadRequestException(`Unknown role: ${newRoleName}`);
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { role_name: newRoleName },
      }),
      this.prisma.user_permissions.deleteMany({
        where: { user_id: targetUserId },
      }),
    ]);
  }

  /**
   * Ensures the requester may load or edit permission state for `targetUserId`
   * (SUPER_ADMIN or same-company COMPANY_ADMIN).
   */
  async assertCanManageTargetUserPermissions(
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    const requester = await this.prisma.user.findUniqueOrThrow({
      where: { id: requesterId },
      select: { role_name: true, companyId: true },
    });

    if (!MANAGER_ROLES.has(requester.role_name)) {
      throw new ForbiddenException(
        'You cannot view or change user permissions',
      );
    }

    if (requester.role_name === 'SUPER_ADMIN') {
      return;
    }

    const target = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { companyId: true },
    });

    if (target.companyId !== requester.companyId) {
      throw new ForbiddenException(
        'You can only manage users in your own company',
      );
    }
  }

  async getUserPermissionsForManagement(
    targetUserId: string,
  ): Promise<UserPermissionsManagementResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: targetUserId },
      select: { role_name: true },
    });

    const [allPermissions, roleDefaults, userOverrides] = await Promise.all([
      this.prisma.permissions.findMany({ orderBy: { group_name: 'asc' } }),
      this.prisma.role_permissions.findMany({
        where: { role_name: user.role_name },
      }),
      this.prisma.user_permissions.findMany({
        where: { user_id: targetUserId },
      }),
    ]);

    const roleDefaultMap = new Map(
      roleDefaults.map((rd) => [rd.permission_key, rd.is_default_on]),
    );
    const overrideMap = new Map(
      userOverrides.map((uo) => [uo.permission_key, uo.is_granted]),
    );

    const groups = new Map<string, UserPermissionsManagementResponse[string]>();

    for (const perm of allPermissions) {
      const roleDefault = roleDefaultMap.get(perm.key);
      if (roleDefault === undefined) continue;

      const override = overrideMap.get(perm.key);
      const roleDefaultBool = roleDefault;
      const isGranted: boolean =
        override !== undefined ? override : roleDefaultBool;
      const item: UserPermissionManagementItem = {
        key: perm.key,
        label: perm.label,
        description: perm.description ?? null,
        isGranted,
        isOverridden: override !== undefined,
        roleDefault: roleDefaultBool,
      };

      const list = groups.get(perm.group_name) ?? [];
      list.push(item);
      groups.set(perm.group_name, list);
    }

    return Object.fromEntries(groups);
  }
}
