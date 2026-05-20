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
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingCycle } from '@prisma/client';
import { SubscriptionsService } from './subscriptions.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';
import { BillingRecordWithRecorderResponseDto } from './dto/billing-record-response.dto';
import { ScheduleSubscriptionUpgradeDto } from './dto/schedule-subscription-upgrade.dto';
import { RecordSubscriptionPaymentDto } from './dto/record-subscription-payment.dto';
import { CancelSubscriptionDto } from './dto/cancel-subscription.dto';
import { AdminBillingOverviewResponseDto } from './dto/admin-billing-overview.response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { Roles } from '../../common/decorators/roles.decorator';
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
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERM.platformAdminAccess)
  @ApiOperation({ summary: 'Admin billing dashboard aggregates' })
  getBillingOverview(): Promise<AdminBillingOverviewResponseDto> {
    return this.subscriptionsService.getAdminBillingOverview();
  }

  @Get(':id')
  @RequirePermissions(PERM.companyBillingView)
  @ApiOperation({ summary: 'Get subscription by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionsService.findOne(id, user);
  }

  @Get(':id/history')
  @RequirePermissions(PERM.companyBillingView)
  @ApiOperation({ summary: 'Billing history for a subscription' })
  getBillingHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BillingRecordWithRecorderResponseDto[]> {
    return this.subscriptionsService.getBillingHistory(id, user);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERM.platformAdminAccess)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create subscription with setup billing record' })
  create(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionsService.create(
      {
        companyId: dto.companyId,
        planId: dto.planId,
        billingCycle: dto.billingCycle ?? BillingCycle.MONTHLY,
        initialPayment: dto.initialPayment,
        startedAt: dto.startedAt,
      },
      user.id,
    );
  }

  @Put(':id/schedule-upgrade')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERM.platformAdminAccess)
  @ApiOperation({ summary: 'Schedule plan upgrade for next billing cycle' })
  scheduleUpgrade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleSubscriptionUpgradeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptionsService.scheduleUpgrade(id, dto.newPlanId, user);
  }

  @Put(':id/cancel-upgrade')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERM.platformAdminAccess)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a scheduled upgrade' })
  cancelUpgrade(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptionsService.cancelUpgrade(id, user);
  }

  @Post(':id/record-payment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
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

  @Put(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('SUPER_ADMIN')
  @RequirePermissions(PERM.platformAdminAccess)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel subscription' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptionsService.cancel(id, dto.reason, user);
  }
}
