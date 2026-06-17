import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantRoles } from '../../common/decorators/tenant-roles.decorator';
import { TENANT_ROLES } from '../../common/auth/user-role.util';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  NotificationListResponseDto,
  NotificationResponseDto,
} from './dto/notification-response.dto';

@ApiTags('Notifications')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @RequirePermissions(PERM.companyNotificationsView)
  @Get()
  @TenantRoles()
  @ApiOperation({
    summary:
      'List notifications. CLIENT is scoped to their company; SUPER_ADMIN sees all companies unless companyId is provided.',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponseDto> {
    return this.notifications.findAll(user, query);
  }

  @RequirePermissions(PERM.companyNotificationsView)
  @Get(':id')
  @TenantRoles()
  @ApiOperation({ summary: 'Get a single notification (tenant-scoped).' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    return this.notifications.findOne(id, user);
  }

  @RequirePermissions(PERM.companyNotificationsManage)
  @Post('mark-read/:id')
  @HttpCode(HttpStatus.OK)
  @TenantRoles()
  @ApiOperation({
    summary:
      'Mark a notification as read (legacy path alias for dashboard clients).',
  })
  markReadLegacy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    return this.notifications.markRead(id, user);
  }

  @RequirePermissions(PERM.companyNotificationsManage)
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @TenantRoles()
  @ApiOperation({
    summary:
      'Mark a notification as read. Idempotent — repeat calls return the same readAt.',
  })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    return this.notifications.markRead(id, user);
  }

  @RequirePermissions(PERM.companyNotificationsManage)
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @Roles(...TENANT_ROLES)
  @ApiOperation({
    summary:
      'Mark all unread notifications for the requester company as read. Tenant roles only.',
  })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user);
  }
}
