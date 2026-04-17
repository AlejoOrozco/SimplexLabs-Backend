import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
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

/**
 * State machine for order lifecycle.
 * Terminal states (`COMPLETED`, `CANCELLED`) do not allow further transitions.
 */
const VALID_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  };

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

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    const row = await this.loadOrderOrThrow(id, requester);
    return toOrderResponse(row);
  }

  async create(
    dto: CreateOrderDto,
    requester: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    if (!requester.companyId) {
      throw new ForbiddenException(
        'Only users scoped to a company can create orders',
      );
    }
    const companyId = requester.companyId;

    await this.assertContactAndProductBelongToCompany(
      dto.contactId,
      dto.productId,
      companyId,
    );

    const row = await this.prisma.order.create({
      data: {
        companyId,
        contactId: dto.contactId,
        productId: dto.productId,
        status: OrderStatus.PENDING,
        amount: new Prisma.Decimal(dto.amount),
        notes: dto.notes ?? null,
      },
      include: orderInclude,
    });
    return toOrderResponse(row);
  }

  async updateStatus(
    id: string,
    dto: UpdateOrderStatusDto,
    requester: AuthenticatedUser,
  ): Promise<OrderResponseDto> {
    const existing = await this.loadOrderOrThrow(id, requester);

    if (existing.status === dto.newStatus) {
      throw new BadRequestException(
        `Order is already in status ${dto.newStatus}`,
      );
    }

    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed.includes(dto.newStatus)) {
      throw new BadRequestException(
        `Cannot transition order from ${existing.status} to ${dto.newStatus}`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.order.update({
        where: { id },
        data: { status: dto.newStatus },
        include: orderInclude,
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          changedById: requester.id,
          prevStatus: existing.status,
          newStatus: dto.newStatus,
          reason: dto.reason ?? null,
        },
      });

      return next;
    });

    return toOrderResponse(updated);
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

  // ---------- private helpers ----------

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

  /**
   * Guards against an authenticated user creating an order that references
   * a contact or product belonging to a different tenant. The DB foreign keys
   * alone are not enough — they'd allow cross-company attachment.
   */
  private async assertContactAndProductBelongToCompany(
    contactId: string,
    productId: string,
    companyId: string,
  ): Promise<void> {
    const [contact, product] = await Promise.all([
      this.prisma.clientContact.findUnique({
        where: { id: contactId },
        select: { companyId: true },
      }),
      this.prisma.product.findUnique({
        where: { id: productId },
        select: { companyId: true, isActive: true },
      }),
    ]);

    if (!contact) {
      throw new NotFoundException(`Contact ${contactId} not found`);
    }
    if (contact.companyId !== companyId) {
      throw new ForbiddenException('Contact does not belong to your company');
    }

    if (!product) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    if (product.companyId !== companyId) {
      throw new ForbiddenException('Product does not belong to your company');
    }
    if (!product.isActive) {
      throw new BadRequestException(`Product ${productId} is inactive`);
    }
  }
}
