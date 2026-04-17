import { ApiProperty } from '@nestjs/swagger';
import type { OrderStatus } from '@prisma/client';

export class OrderStatusChangedByDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

export class OrderStatusHistoryEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    enum: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    nullable: true,
  })
  prevStatus!: OrderStatus | null;

  @ApiProperty({
    enum: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  })
  newStatus!: OrderStatus;

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: OrderStatusChangedByDto })
  changedBy!: OrderStatusChangedByDto;
}
