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
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { RejectAppointmentDto } from './dto/reject-appointment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Appointments')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List appointments — scoped to requester company' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto[]> {
    return this.appointmentsService.findAll(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get appointment by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.findOne(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create appointment' })
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AppointmentResponseDto> {
    return this.appointmentsService.create(dto, user);
  }

  @Put(':id')
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
  @ApiOperation({ summary: 'Delete appointment' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.appointmentsService.remove(id, user);
  }

  @Post(':id/confirm')
  @Roles('SUPER_ADMIN', 'CLIENT')
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
