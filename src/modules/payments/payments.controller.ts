import {
  Controller,
  Get,
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
}
