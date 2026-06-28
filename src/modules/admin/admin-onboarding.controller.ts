import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { AdminService } from './admin.service';
import { SendOnboardingCredentialsDto } from './dto/send-onboarding-credentials.dto';

@ApiTags('Admin · Onboarding')
@ApiCookieAuth('access_token')
@Controller('admin/onboarding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminOnboardingController {
  constructor(private readonly admin: AdminService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Post('send-credentials')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Email portal credentials to a CLIENT or COMPANY_ADMIN user (Resend / SMTP)',
  })
  sendCredentials(@Body() dto: SendOnboardingCredentialsDto) {
    return this.admin.sendOnboardingCredentials(dto);
  }
}
