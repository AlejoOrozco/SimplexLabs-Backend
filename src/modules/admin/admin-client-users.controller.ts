import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { CreateClientUserDto } from './dto/create-client-user.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { DeactivateClientDto } from './dto/deactivate-client.dto';

@ApiTags('Admin · Client users')
@ApiCookieAuth('access_token')
@Controller('admin/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminClientUsersController {
  constructor(private readonly admin: AdminService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Post('create-client')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a COMPANY_ADMIN user for an existing company (Supabase + platform user)',
  })
  createClient(
    @Body() dto: CreateClientUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.createClientUser(dto, user.id);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Post('create-staff')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a company staff user with optional permission overrides (Supabase + platform user)',
  })
  createStaff(
    @Body() dto: CreateStaffUserDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.createStaffUser(dto, user.id);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a client user and mark the company inactive',
  })
  deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DeactivateClientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.deactivateClient(id, dto, user);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivate a client user and clear company deactivation',
  })
  reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.reactivateClient(id, user);
  }
}
