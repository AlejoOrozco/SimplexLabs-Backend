import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PermissionsService } from './permissions.service';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import type { UserPermissionsManagementResponse } from './permissions.types';

@ApiTags('Permissions')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get('users/:userId')
  @RequirePermissions(PERM.companyUsersPermissions)
  @ApiOperation({ summary: 'Permission matrix for management UI' })
  async getUserPermissions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() requester: AuthenticatedUser,
  ): Promise<UserPermissionsManagementResponse> {
    await this.permissionsService.assertCanManageTargetUserPermissions(
      requester.id,
      userId,
    );
    return this.permissionsService.getUserPermissionsForManagement(userId);
  }

  @Put('users/:userId')
  @RequirePermissions(PERM.companyUsersPermissions)
  @ApiOperation({ summary: 'Update user permission overrides' })
  async updateUserPermissions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserPermissionsDto,
    @CurrentUser() requester: AuthenticatedUser,
  ): Promise<void> {
    await this.permissionsService.assertCanManageTargetUserPermissions(
      requester.id,
      userId,
    );
    await this.permissionsService.updateUserPermissions(
      userId,
      dto.updates.map((u) => ({
        permissionKey: u.permissionKey,
        isGranted: u.isGranted,
      })),
      requester.id,
    );
  }

  @Put('users/:userId/role')
  @RequirePermissions(PERM.companyUsersPermissions)
  @ApiOperation({ summary: 'Change user role (clears permission overrides)' })
  async updateUserRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() requester: AuthenticatedUser,
  ): Promise<void> {
    await this.permissionsService.assertCanManageTargetUserPermissions(
      requester.id,
      userId,
    );
    await this.permissionsService.updateUserRole(
      userId,
      dto.newRoleName,
      requester.id,
    );
  }
}
