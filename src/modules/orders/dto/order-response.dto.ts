import { ApiProperty } from '@nestjs/swagger';
import type { OrderStatus, ProductType } from '@prisma/client';

export class OrderContactSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}

export class OrderProductSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['PRODUCT', 'SERVICE'] })
  type!: ProductType;

  @ApiProperty({ description: 'Decimal serialized as string' })
  price!: string;
}

export class OrderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  contactId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty({
    enum: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  })
  status!: OrderStatus;

  @ApiProperty({ description: 'Decimal serialized as string' })
  amount!: string;

  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: OrderContactSummaryDto })
  contact!: OrderContactSummaryDto;

  @ApiProperty({ type: OrderProductSummaryDto })
  product!: OrderProductSummaryDto;
}
