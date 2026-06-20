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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { ReviewWirePaymentDto } from './dto/review-wire-payment.dto';
import { AttachWireScreenshotDto } from './dto/attach-wire-screenshot.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

@ApiTags('Payments')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @RequirePermissions(PERM.companyPaymentsView)
  @Get()
  @ApiOperation({ summary: 'List payments scoped to requester company.' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto[]> {
    return this.payments.findAll(user);
  }

  @RequirePermissions(PERM.companyPaymentsView)
  @Get(':id')
  @ApiOperation({ summary: 'Get payment detail + event log.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    return this.payments.findOne(id, user);
  }

  @RequirePermissions(PERM.companyPaymentsManage)
  @Post('initiate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Initiate a payment for an existing order. Returns checkoutUrl for STRIPE or wireInstructions for WIRE_TRANSFER.',
  })
  initiate(
    @Body() dto: InitiatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    return this.payments.initiate(dto, user);
  }

  @RequirePermissions(PERM.companyPaymentsManage)
  @Post(':id/wire/screenshot')
  @ApiOperation({
    summary:
      'Attach an uploaded wire-transfer screenshot URL. Transitions AWAITING_SCREENSHOT → PENDING_REVIEW.',
  })
  attachScreenshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachWireScreenshotDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    return this.payments.attachWireScreenshot(id, dto, user);
  }

  @RequirePermissions(PERM.companyPaymentsManage)
  @Post(':id/wire/review')
  @ApiOperation({
    summary:
      'Approve or reject a pending wire transfer payment. Only valid from PENDING_REVIEW.',
  })
  reviewWire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewWirePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    return this.payments.reviewWire(id, dto, user);
  }
}
