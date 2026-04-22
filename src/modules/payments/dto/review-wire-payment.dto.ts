import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewWirePaymentDto {
  @ApiProperty({
    enum: ['APPROVE', 'REJECT'],
    description: 'Reviewer decision on the uploaded wire screenshot.',
  })
  @IsString()
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({
    description:
      'Free-text reason; required for REJECT (UI should enforce), ' +
      'optional note for APPROVE. Persisted on the PaymentEvent.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
