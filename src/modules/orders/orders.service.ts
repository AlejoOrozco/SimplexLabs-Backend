import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderStatusHistoryEntryDto } from './dto/order-status-history.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';
import {
  orderHistoryInclude,
  orderInclude,
  toOrderHistoryEntry,
  toOrderResponse,
} from './order.mapper';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(requester: AuthenticatedUser): Promise<OrderResponseDto[]> {
    const rows = await this.prisma.order.findMany({
      where: scopedCompanyWhere(requester),
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toOrderResponse);
  }

  async findHistory(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<OrderStatusHistoryEntryDto[]> {
    await this.loadOrderOrThrow(id, requester);

    const rows = await this.prisma.orderStatusHistory.findMany({
      where: { orderId: id },
      include: orderHistoryInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toOrderHistoryEntry);
  }

  private async loadOrderOrThrow(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<Prisma.OrderGetPayload<{ include: typeof orderInclude }>> {
    const row = await this.prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });
    if (!row) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    assertTenantAccess(row.companyId, requester);
    return row;
  }
}
