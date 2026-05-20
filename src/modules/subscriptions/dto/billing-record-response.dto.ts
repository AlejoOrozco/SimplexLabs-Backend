import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { BillingRecordStatus } from '@prisma/client';

export class BillingRecordResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'Decimal as string' })
  amount!: string;

  @ApiProperty({ enum: ['PENDING', 'PAID', 'OVERDUE', 'WAIVED'] })
  status!: BillingRecordStatus;

  @ApiProperty()
  isSetupFee!: boolean;

  @ApiPropertyOptional({ type: Date, nullable: true })
  paidAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;
}

export class BillingRecordWithRecorderResponseDto extends BillingRecordResponseDto {
  @ApiPropertyOptional({
    description: 'User who recorded the payment, when known',
  })
  recordedBy?: { id: string; firstName: string; lastName: string } | null;
}
