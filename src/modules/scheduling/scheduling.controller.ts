import {
  Body,
  Controller,
  Delete,
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
import { BlockedTimesService } from './blocked-times.service';
import { AvailabilityService } from './availability.service';
import {
  BlockedTimeResponseDto,
  CreateBlockedTimeDto,
  ListBlockedTimesQueryDto,
} from './dto/blocked-time.dto';
import {
  AvailabilityQueryDto,
  AvailabilityResponseDto,
} from './dto/availability.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Scheduling')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('SUPER_ADMIN', 'CLIENT')
@Controller('scheduling')
export class SchedulingController {
  constructor(
    private readonly blockedTimes: BlockedTimesService,
    private readonly availability: AvailabilityService,
  ) {}

  // ---------------- Blocked times ----------------

  @RequirePermissions(PERM.companySchedulingView)
  @Get('blocked-times')
  @ApiOperation({
    summary:
      'List blocked times (staff + company-wide). Filter by staffId / date window.',
  })
  listBlockedTimes(
    @Query() query: ListBlockedTimesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BlockedTimeResponseDto[]> {
    return this.blockedTimes.list(user, query);
  }

  @RequirePermissions(PERM.companySchedulingManage)
  @Post('blocked-times')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a blocked range. Omit staffId for a company-wide block (e.g. holiday).',
  })
  createBlockedTime(
    @Body() dto: CreateBlockedTimeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BlockedTimeResponseDto> {
    return this.blockedTimes.create(dto, user);
  }

  @RequirePermissions(PERM.companySchedulingManage)
  @Delete('blocked-times/:id')
  @ApiOperation({ summary: 'Delete a blocked range' })
  removeBlockedTime(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.blockedTimes.remove(id, user);
  }

  // ---------------- Availability ----------------

  @RequirePermissions(PERM.companySchedulingView)
  @Get('availability')
  @ApiOperation({
    summary:
      'Compute bookable slots for the requester company within a date window.',
  })
  getAvailability(
    @Query() query: AvailabilityQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AvailabilityResponseDto> {
    return this.availability.findForRequester(user, query);
  }
}
