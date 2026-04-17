import { ApiProperty } from '@nestjs/swagger';
import type { ProductType } from '@prisma/client';

export class ProductResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ enum: ['PRODUCT', 'SERVICE'] })
  type!: ProductType;

  @ApiProperty({ description: 'Decimal price serialized as string' })
  price!: string;

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
