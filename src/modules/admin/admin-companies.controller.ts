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
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CreateFullCompanyDto } from './dto/create-full-company.dto';
import { AdminCompanyListRowDto } from './dto/admin-company-list-row.dto';
import { ReactivateCompanyResponseDto } from './dto/reactivate-company-response.dto';
import { AdminService } from './admin.service';
import { AdminClientDetailService } from './dashboard/admin-client-detail.service';
import { AdminManageSummaryService } from './dashboard/admin-manage-summary.service';
import { CompaniesService } from '../companies/companies.service';
import { UpdateCompanyDto } from '../companies/dto/update-company.dto';
import { CompanyResponseDto } from '../companies/dto/company-response.dto';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@ApiTags('Admin · Companies')
@ApiCookieAuth('access_token')
@Controller('admin/companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminCompaniesController {
  constructor(
    private readonly admin: AdminService,
    private readonly companyDetail: AdminClientDetailService,
    private readonly manageSummary: AdminManageSummaryService,
    private readonly companies: CompaniesService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Post('create-full')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create company, subscriptions, and optional agent config (no user) in one DB transaction',
  })
  createFull(
    @Body() dto: CreateFullCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.createFullCompany(dto, user.id);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Get()
  @ApiOperation({
    summary: 'List all companies with subscription, primary admin, and rollups',
    description:
      'Canonical tenant directory for SUPER_ADMIN consoles. Includes the first active COMPANY_ADMIN, the most recent ACTIVE subscription (up to three loaded server-side), and conversation/order counts.',
  })
  @ApiOkResponse({ type: [AdminCompanyListRowDto] })
  listCompanies(): Promise<AdminCompanyListRowDto[]> {
    return this.admin.listAdminCompanies();
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put(':companyId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Reactivate entire company: clear deactivation and set all inactive tenant users to active',
    description:
      'Use after DELETE /companies/:id or any flow that deactivated the company and multiple users. For single CLIENT portal user only, PUT /admin/users/:id/reactivate is also available.',
  })
  @ApiOkResponse({ type: ReactivateCompanyResponseDto })
  reactivateCompany(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReactivateCompanyResponseDto> {
    return this.admin.reactivateCompany(companyId, user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Get(':companyId/manage-summary')
  @ApiOperation({
    summary: 'Hub dashboard snapshot — company, subscriptions, users, setup gaps',
    description:
      'Lightweight aggregate for the admin management center. Use /detail for deep timelines and KPIs.',
  })
  getManageSummary(@Param('companyId', new ParseUUIDPipe()) companyId: string) {
    return this.manageSummary.getManageSummary(companyId);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Get(':companyId/billing-overview')
  @ApiOperation({ summary: 'Per-company MRR, next charge, and recent payments' })
  getBillingOverview(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
  ) {
    return this.subscriptions.getCompanyBillingOverview(companyId);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put(':companyId')
  @ApiOperation({
    summary: 'Update company profile, notifications, and WhatsApp fields',
    description:
      'Same fields as PUT /companies/:id plus SUPER_ADMIN niche editing. Channel tokens still require POST /channels.',
  })
  @ApiOkResponse({ type: CompanyResponseDto })
  updateCompany(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompanyResponseDto> {
    return this.companies.update(companyId, dto, user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Get(':companyId/detail')
  @ApiOperation({
    summary: 'Read-only deep view of a single company for the admin detail panel',
    description:
      'Returns mapped company profile, KPI stats, capped conversation/order/appointment timelines, and recent agent runs. No secrets (e.g. supabaseId, channel tokens).',
  })
  getCompanyDetail(@Param('companyId', new ParseUUIDPipe()) companyId: string) {
    return this.companyDetail.getClientDetail(companyId);
  }
}
