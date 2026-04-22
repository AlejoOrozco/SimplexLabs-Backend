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
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { InitiatePaymentDto } from './dto/initiate-payment.dto';
import { ReviewWirePaymentDto } from './dto/review-wire-payment.dto';
import { AttachWireScreenshotDto } from './dto/attach-wire-screenshot.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

@ApiTags('Payments')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @Roles('SUPER_ADMIN', 'CLIENT')
  @ApiOperation({ summary: 'List payments scoped to requester company.' })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto[]> {
    return this.payments.findAll(user);
  }

  @Get(':id')
  @Roles('SUPER_ADMIN', 'CLIENT')
  @ApiOperation({ summary: 'Get payment detail + event log.' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaymentResponseDto> {
    return this.payments.findOne(id, user);
  }

  @Post('initiate')
  @Roles('SUPER_ADMIN', 'CLIENT')
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

  @Post(':id/wire/screenshot')
  @Roles('SUPER_ADMIN', 'CLIENT')
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

  @Post(':id/wire/review')
  @Roles('SUPER_ADMIN', 'CLIENT')
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
