import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectAppointmentDto {
  @ApiPropertyOptional({
    description:
      'Internal reason for rejection (not sent to the customer). Optional.',
    maxLength: 240,
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}
