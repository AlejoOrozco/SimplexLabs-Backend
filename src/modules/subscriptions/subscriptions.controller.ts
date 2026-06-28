import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { RecordSubscriptionPaymentDto } from './dto/record-subscription-payment.dto';
import { AdminBillingOverviewResponseDto } from './dto/admin-billing-overview.response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Subscriptions')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @RequirePermissions(PERM.companyBillingView)
  @ApiOperation({ summary: 'List subscriptions for the caller scope' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto[]> {
    return this.subscriptionsService.findAll(user);
  }

  @Get('admin/billing-overview')
  @RequirePermissions(PERM.platformAdminAccess)
  @ApiOperation({ summary: 'Admin billing dashboard aggregates' })
  getBillingOverview(): Promise<AdminBillingOverviewResponseDto> {
    return this.subscriptionsService.getAdminBillingOverview();
  }

  @Post(':id/record-payment')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERM.platformAdminAccess)
  @ApiOperation({ summary: 'Record a subscription payment and advance period' })
  recordPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordSubscriptionPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptionsService.recordPayment(
      { ...dto, subscriptionId: id },
      user.id,
      user,
    );
  }
}
