import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductResponseDto } from './dto/product-response.dto';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { scopedCompanyWhere } from '../../common/tenant/tenant-scope';

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
}
