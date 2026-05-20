import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { CheckAvailabilityDto } from './dto/check-availability.dto';
import { MoveAppointmentDto } from './dto/move-appointment.dto';
import { CreateRecurringDto } from './dto/create-recurring.dto';
import { CalendarStaffQueryDto } from './dto/calendar-staff-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { isSuperAdmin } from '../../common/auth/user-role.util';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

@ApiTags('Calendar')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @RequirePermissions(PERM.companyCalendarView)
  @Get('events')
  @ApiOperation({
    summary: 'Fetch appointments for a date range (FullCalendar)',
  })
  getEvents(
    @Query() query: CalendarQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendarService.getCalendarEvents(query, user);
  }

  @RequirePermissions(PERM.companyCalendarManage)
  @Post('check-availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if a time slot is available' })
  checkAvailability(
    @Body() dto: CheckAvailabilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendarService.checkAvailability(dto, user);
  }

  @RequirePermissions(PERM.companyCalendarManage)
  @Put('appointments/:id/move')
  @ApiOperation({ summary: 'Move an appointment (organizer only)' })
  moveAppointment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendarService.moveAppointment(id, dto, user);
  }

  @RequirePermissions(PERM.companyCalendarManage)
  @Post('appointments/:id/recurring')
  @ApiOperation({ summary: 'Make an existing appointment recurring' })
  createRecurring(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRecurringDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.calendarService.createRecurringAppointments(id, dto, user);
  }

  @RequirePermissions(PERM.companyCalendarView)
  @Get('staff')
  @ApiOperation({ summary: 'Staff list for calendar filter' })
  getStaff(
    @Query() query: CalendarStaffQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const companyId = isSuperAdmin(user)
      ? query.companyId
      : user.companyId ?? undefined;
    if (isSuperAdmin(user) && !companyId) {
      throw new BadRequestException(
        'companyId query parameter is required for SUPER_ADMIN',
      );
    }
    return this.calendarService.getStaffMembers(companyId as string, user);
  }
}
