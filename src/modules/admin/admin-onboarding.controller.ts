import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { CuidParamPipe } from '../../common/pipes/cuid-param.pipe';
import { AdminService } from './admin.service';
import { SaveOnboardingDraftDto } from './dto/save-onboarding-draft.dto';
import { SendOnboardingCredentialsDto } from './dto/send-onboarding-credentials.dto';

@ApiTags('Admin · Onboarding')
@ApiCookieAuth('access_token')
@Controller('admin/onboarding')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminOnboardingController {
  constructor(private readonly admin: AdminService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Post('draft')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save or update wizard progress' })
  saveDraft(
    @Body() dto: SaveOnboardingDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ draftId: string }> {
    return this.admin.saveOnboardingDraft(dto, user.id);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Get('draft/:id')
  @ApiOperation({ summary: 'Restore a saved draft' })
  getDraft(
    @Param('id', CuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.admin.getOnboardingDraft(id, user.id);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Post('send-credentials')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email portal credentials (uses configured SMTP / provider)',
  })
  sendCredentials(@Body() dto: SendOnboardingCredentialsDto) {
    return this.admin.sendOnboardingCredentials(dto);
  }
}
