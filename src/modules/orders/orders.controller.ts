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
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderStatusHistoryEntryDto } from './dto/order-status-history.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PERM } from '../../common/auth/permission-keys';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Orders')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @RequirePermissions(PERM.companyOrdersView)
  @Get()
  @ApiOperation({ summary: 'List orders — scoped to requester company' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<OrderResponseDto[]> {
    return this.ordersService.findAll(user);
  }

  @RequirePermissions(PERM.companyOrdersView)
  @Get(':id')
  @ApiOperation({ summary: 'Get order by id' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findOne(id, user);
  }

  @RequirePermissions(PERM.companyOrdersView)
  @Get(':id/history')
  @ApiOperation({ summary: 'Get full status-change history for an order' })
  findHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderStatusHistoryEntryDto[]> {
    return this.ordersService.findHistory(id, user);
  }

  @RequirePermissions(PERM.companyOrdersManage)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create order (starts in PENDING)' })
  create(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.create(dto, user);
  }

  @RequirePermissions(PERM.companyOrdersManage)
  @Put(':id/status')
  @ApiOperation({
    summary: 'Transition order to a new status (enforces valid transitions)',
  })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updateStatus(id, dto, user);
  }
}
