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
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionResponseDto } from '../subscriptions/dto/subscription-response.dto';
import { CancelSubscriptionDto } from '../subscriptions/dto/cancel-subscription.dto';
import { AssignCompanySubscriptionDto } from './dto/assign-company-subscription.dto';
import { UpdateCompanySubscriptionDto } from './dto/update-company-subscription.dto';
import { SwapSubscriptionPlanDto } from './dto/swap-subscription-plan.dto';

@ApiTags('Admin · Company subscriptions')
@ApiCookieAuth('access_token')
@Controller('admin/companies/:companyId/subscriptions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AdminCompanySubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @RequirePermissions(PERM.platformAdminAccess)
  @Get()
  @ApiOperation({ summary: 'List all subscriptions for a company' })
  @ApiOkResponse({ type: [SubscriptionResponseDto] })
  list(
    @Param('companyId', ParseUUIDPipe) companyId: string,
  ): Promise<SubscriptionResponseDto[]> {
    return this.subscriptions.findByCompanyId(companyId);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Assign a subscription plan to a company',
    description:
      'Max one ACTIVE/PAUSED subscription per plan category. Pass replaceExisting: true to cancel and swap atomically.',
  })
  assign(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AssignCompanySubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptions.assignToCompany(
      companyId,
      {
        companyId,
        planId: dto.planId,
        billingCycle: dto.billingCycle,
        status: dto.status,
        initialPayment: dto.initialPayment ?? undefined,
        startedAt: dto.startedAt,
        nextBillingAt: dto.nextBillingAt,
        replaceExisting: dto.replaceExisting,
      },
      user.id,
    );
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put(':subscriptionId')
  @ApiOperation({
    summary: 'Update subscription billing and lifecycle fields',
  })
  update(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: UpdateCompanySubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptions.updateAdmin(companyId, subscriptionId, dto);
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Put(':subscriptionId/plan')
  @ApiOperation({
    summary: 'Swap plan within the same category (immediate, atomic)',
  })
  swapPlan(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: SwapSubscriptionPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptions.swapPlanImmediate(
      companyId,
      subscriptionId,
      dto,
      user.id,
    );
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Post(':subscriptionId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a company subscription' })
  cancel(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: CancelSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ cancelled: boolean }> {
    return this.subscriptions.cancel(subscriptionId, dto.reason, {
      ...user,
      companyId,
    });
  }

  @RequirePermissions(PERM.platformAdminAccess)
  @Post(':subscriptionId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivate a cancelled subscription' })
  reactivate(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptions.reactivate(companyId, subscriptionId);
  }
}
