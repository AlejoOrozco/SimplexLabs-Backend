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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppointmentsService } from './appointments.service';
import { AttendeesService } from '../attendees/attendees.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { RejectAppointmentDto } from './dto/reject-appointment.dto';
import { MarkCallbackHandledDto } from './dto/mark-callback-handled.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AddAttendeeDto } from '../attendees/dto/add-attendee.dto';
import { RespondInvitationDto } from '../attendees/dto/respond-invitation.dto';
import type { AttendeeResponseDto } from '../attendees/dto/attendee-response.dto';

@ApiTags('Appointments')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly attendeesService: AttendeesService,
  ) {}

  @Get()
  @RequirePermissions(PERM.companyAppointmentsView)
  @ApiOperation({ summary: 'List appointments — scoped to requester company' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto[]> {
    return this.appointmentsService.findAll(user);
  }

  @Get(':id/attendees')
  @RequirePermissions(PERM.companyAppointmentsAttendees)
  @ApiOperation({ summary: 'List attendees for an appointment' })
  getAttendees(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendeeResponseDto[]> {
    return this.attendeesService.getAttendees(id, user);
  }

  @Post(':id/attendees')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERM.companyAppointmentsAttendees)
  @ApiOperation({ summary: 'Add an attendee to an appointment' })
  addAttendee(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAttendeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendeeResponseDto> {
    return this.attendeesService.addAttendee(
      id,
      { userId: dto.userId, contactId: dto.contactId },
      user,
    );
  }

  @Put(':id/respond')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERM.companyAppointmentsAttendees)
  @ApiOperation({ summary: 'Accept or decline an appointment invitation' })
  respondInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondInvitationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendeeResponseDto> {
    return this.attendeesService.respondToInvitation(id, dto.status, user);
  }

  @Delete(':id/attendees/:attendeeId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERM.companyAppointmentsAttendees)
  @ApiOperation({ summary: 'Remove an attendee from an appointment' })
  removeAttendee(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attendeeId', ParseUUIDPipe) attendeeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ removed: boolean }> {
    return this.attendeesService.removeAttendee(id, attendeeId, user);
  }

  @Get(':id')
  @RequirePermissions(PERM.companyAppointmentsView)
  @ApiOperation({ summary: 'Get appointment by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.findOne(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(PERM.companyAppointmentsManage)
  @ApiOperation({ summary: 'Create appointment' })
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.create(dto, user);
  }

  @Put(':id/request-callback')
  @Roles('CLIENT')
  @RequirePermissions(PERM.companyAppointmentsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Request a phone callback instead of confirming (SimplexLabs ↔ client appointments only).',
  })
  requestCallback(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ requested: true }> {
    return this.appointmentsService.requestCallback(id, user);
  }

  @Put(':id/mark-callback-handled')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERM.companyAppointmentsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mark a client callback as handled after the operator has reached them.',
  })
  markCallbackHandled(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkCallbackHandledDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.markCallbackHandled(id, dto, user);
  }

  @Put(':id')
  @RequirePermissions(PERM.companyAppointmentsManage)
  @ApiOperation({ summary: 'Update appointment' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERM.companyAppointmentsManage)
  @ApiOperation({ summary: 'Delete appointment' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.appointmentsService.remove(id, user);
  }

  @Post(':id/confirm')
  @Roles('SUPER_ADMIN', 'CLIENT')
  @RequirePermissions(PERM.companyAppointmentsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Confirm a PENDING appointment. Sends a WhatsApp confirmation to the customer.',
  })
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.confirm(id, user);
  }

  @Post(':id/reject')
  @Roles('SUPER_ADMIN', 'CLIENT')
  @RequirePermissions(PERM.companyAppointmentsManage)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Reject a PENDING/CONFIRMED appointment. Transitions status to CANCELLED.',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.reject(id, dto, user);
  }
}
