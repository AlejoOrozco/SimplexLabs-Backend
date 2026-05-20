import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckAvailabilityDto {
  @ApiProperty({ description: 'Proposed start time in UTC ISO 8601' })
  @IsDateString()
  proposedStart!: string;

  @ApiProperty()
  @IsInt()
  @Min(15)
  durationMinutes!: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  staffMemberId?: string;

  @ApiPropertyOptional({
    description: 'Exclude this appointment when checking (e.g. reschedule)',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  excludeAppointmentId?: string;

  @ApiPropertyOptional({
    description: 'Required for SUPER_ADMIN when checking another company',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  companyId?: string;
}
