import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiCookieAuth } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { CompanyResponseDto } from './dto/company-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Companies')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Get()
  @ApiOperation({ summary: 'List all companies — platform admin only' })
  findAll(): Promise<CompanyResponseDto[]> {
    return this.companiesService.findAll();
  }

  @RequirePermissions(PERM.companyCompaniesView)
  @Get(':id')
  @ApiOperation({ summary: 'Get one company — admin or own company' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompanyResponseDto> {
    return this.companiesService.findOne(id, user);
  }

  @RequirePermissions(PERM.companyCompaniesManage)
  @Put(':id')
  @ApiOperation({ summary: 'Update company — admin or own company' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CompanyResponseDto> {
    return this.companiesService.update(id, dto, user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete company (soft delete + deactivate company users) — platform admin only',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: boolean }> {
    return this.companiesService.remove(id);
  }
}
