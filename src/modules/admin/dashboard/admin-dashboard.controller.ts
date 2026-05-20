import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { PERM } from '../../../common/auth/permission-keys';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AdminDashboardService } from './admin-dashboard.service';

@ApiTags('Admin · Dashboard')
@ApiCookieAuth('access_token')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles('SUPER_ADMIN')
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Get('dashboard-stats')
  @ApiOperation({
    summary: 'Aggregate KPIs for the SimplexLabs admin home dashboard',
    description:
      '`estimatedMrrDisclaimer` is the tooltip copy for the estimated MRR card (plan-price based, not billed cash).',
  })
  getDashboardStats() {
    return this.dashboard.getDashboardStats();
  }
}
