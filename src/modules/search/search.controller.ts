import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { SearchService, type AttendeeSearchResult } from './search.service';
import { AttendeeSearchQueryDto } from './dto/attendee-search-query.dto';

@ApiTags('search')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('attendees')
  @RequirePermissions(PERM.companyAppointmentsSearch)
  @ApiOperation({ summary: 'Search users/contacts to attach as attendees' })
  async searchAttendees(
    @Query() query: AttendeeSearchQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AttendeeSearchResult[]> {
    const q = query.q ?? '';
    return this.searchService.searchAttendees(
      q,
      user,
      query.appointmentId,
    );
  }
}
