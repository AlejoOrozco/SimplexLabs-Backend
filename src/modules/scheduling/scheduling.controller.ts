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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Scheduling')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'CLIENT')
@Controller('scheduling')
export class SchedulingController {
  constructor(
    private readonly blockedTimes: BlockedTimesService,
    private readonly availability: AvailabilityService,
  ) {}

  // ---------------- Blocked times ----------------

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

  @Delete('blocked-times/:id')
  @ApiOperation({ summary: 'Delete a blocked range' })
  removeBlockedTime(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    return this.blockedTimes.remove(id, user);
  }

  // ---------------- Availability ----------------

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
