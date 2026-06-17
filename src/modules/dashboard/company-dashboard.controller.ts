import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { CompanyDashboardService } from './company-dashboard.service';
import { CompanyDashboardStatsDto } from './dto/company-dashboard-stats.dto';

@ApiTags('Dashboard')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class CompanyDashboardController {
  constructor(private readonly dashboard: CompanyDashboardService) {}

  @RequirePermissions(PERM.companyDashboardView)
  @Get('company-stats')
  @ApiOperation({
    summary: 'Tenant dashboard KPIs scoped to the requester company',
  })
  getCompanyStats(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompanyDashboardStatsDto> {
    return this.dashboard.getCompanyStats(user);
  }
}
