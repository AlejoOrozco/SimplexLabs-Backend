import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class AvailabilityQueryDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  from!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({
    description: 'Limit candidates to a specific staff member.',
  })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({
    description:
      'Overrides CompanySettings.defaultSlotDurationMinutes for this query.',
    minimum: 5,
    maximum: 480,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(480)
  durationMinutes?: number;
}

export class AvailabilitySlotDto {
  @ApiProperty({ type: String, format: 'date-time' })
  startsAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  endsAt!: Date;

  @ApiProperty()
  staffId!: string;

  @ApiProperty()
  staffName!: string;
}

export class AvailabilityResponseDto {
  @ApiProperty() companyId!: string;
  @ApiProperty() timezone!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ type: String, format: 'date-time' }) from!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) to!: Date;
  @ApiProperty({ type: [AvailabilitySlotDto] }) slots!: AvailabilitySlotDto[];
}
