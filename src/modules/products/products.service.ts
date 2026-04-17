import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
  scopedCompanyWhere,
} from '../../common/tenant/tenant-scope';

const productSelect = {
  id: true,
  companyId: true,
  name: true,
  description: true,
  type: true,
  price: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function toProductResponse(product: ProductRow): ProductResponseDto {
  return {
    id: product.id,
    companyId: product.companyId,
    name: product.name,
    description: product.description,
    type: product.type,
    price: product.price.toString(),
    isActive: product.isActive,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(requester: AuthenticatedUser): Promise<ProductResponseDto[]> {
    const rows = await this.prisma.product.findMany({
      where: scopedCompanyWhere(requester),
      select: productSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProductResponse);
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<ProductResponseDto> {
    const row = await this.prisma.product.findUnique({
      where: { id },
      select: productSelect,
    });
    if (!row) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    assertTenantAccess(row.companyId, requester);
    return toProductResponse(row);
  }

  async create(
    dto: CreateProductDto,
    requester: AuthenticatedUser,
  ): Promise<ProductResponseDto> {
    const companyId = resolveCompanyId(requester, dto.companyId);

    try {
      const row = await this.prisma.product.create({
        data: {
          companyId,
          name: dto.name,
          description: dto.description ?? null,
          type: dto.type,
          price: new Prisma.Decimal(dto.price),
          isActive: dto.isActive ?? true,
        },
        select: productSelect,
      });
      return toProductResponse(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        throw new NotFoundException(`Company ${companyId} not found`);
      }
      throw err;
    }
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    requester: AuthenticatedUser,
  ): Promise<ProductResponseDto> {
    await this.findOne(id, requester);

    const data: Prisma.ProductUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.price !== undefined) data.price = new Prisma.Decimal(dto.price);
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const row = await this.prisma.product.update({
      where: { id },
      data,
      select: productSelect,
    });
    return toProductResponse(row);
  }

  async remove(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<{ deleted: boolean }> {
    await this.findOne(id, requester);

    await this.prisma.product.update({
      where: { id },
      data: { isActive: false },
      select: { id: true },
    });
    return { deleted: true };
  }
}
