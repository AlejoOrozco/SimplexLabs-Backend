import { ApiProperty } from '@nestjs/swagger';

export class CompanyDashboardStatsDto {
  @ApiProperty({ description: 'Total orders for the tenant' })
  ordersCount!: number;

  @ApiProperty({ description: 'Total conversations for the tenant' })
  conversationsCount!: number;

  @ApiProperty({ description: 'Active platform users in the tenant' })
  usersCount!: number;

  @ApiProperty({ description: 'Active products for the tenant' })
  productsCount!: number;

  @ApiProperty({
    description: 'Sum of confirmed payment amounts in the current calendar month',
  })
  revenueThisMonth!: number;

  @ApiProperty({ description: 'Unread in-app notifications for the tenant' })
  unreadNotificationsCount!: number;
}
