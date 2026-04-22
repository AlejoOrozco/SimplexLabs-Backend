import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { StaffService } from './staff.service';
import { WorkingHoursService } from './working-hours.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffResponseDto } from './dto/staff-response.dto';
import {
  CreateWorkingHoursDto,
  WorkingHoursResponseDto,
} from './dto/working-hours.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Staff')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'CLIENT')
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly workingHours: WorkingHoursService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List staff — scoped to requester company' })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<StaffResponseDto[]> {
    return this.staff.findAll(user, { activeOnly: activeOnly === 'true' });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get staff by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StaffResponseDto> {
    return this.staff.findOne(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create staff member' })
  create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StaffResponseDto> {
    return this.staff.create(dto, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update staff member' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StaffResponseDto> {
    return this.staff.update(id, dto, user);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      'Deactivate staff (soft delete). Historical appointments are preserved.',
  })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.staff.deactivate(id, user);
  }

  // ------- Working hours (nested) --------------------------------------------

  @Get(':id/working-hours')
  @ApiOperation({ summary: "List a staff member's working hours" })
  listWorkingHours(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkingHoursResponseDto[]> {
    return this.workingHours.list(id, user);
  }

  @Post(':id/working-hours')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a working-hours interval. Rejects overlaps for the same staff/day.',
  })
  createWorkingHours(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWorkingHoursDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorkingHoursResponseDto> {
    return this.workingHours.create(id, dto, user);
  }

  @Delete(':id/working-hours/:whId')
  @ApiOperation({ summary: 'Delete a working-hours interval' })
  deleteWorkingHours(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('whId', ParseUUIDPipe) whId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.workingHours.remove(id, whId, user);
  }
}
