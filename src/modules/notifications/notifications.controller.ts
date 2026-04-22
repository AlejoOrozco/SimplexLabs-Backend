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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
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
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CLIENT')
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

  @Get(':id')
  @Roles('SUPER_ADMIN', 'CLIENT')
  @ApiOperation({ summary: 'Get a single notification (tenant-scoped).' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    return this.notifications.findOne(id, user);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'CLIENT')
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

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @Roles('CLIENT')
  @ApiOperation({
    summary:
      'Mark all unread notifications for the requester company as read. Blocked for SUPER_ADMIN to avoid acknowledging every tenant at once.',
  })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user);
  }
}
