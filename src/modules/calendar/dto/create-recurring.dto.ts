import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum RecurrenceFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

export class CreateRecurringDto {
  @ApiProperty({ enum: RecurrenceFrequency })
  @IsEnum(RecurrenceFrequency)
  frequency!: RecurrenceFrequency;

  @ApiProperty({ description: 'Number of occurrences (including the parent)' })
  @IsInt()
  @Min(2)
  @Max(52)
  count!: number;

  @ApiPropertyOptional({
    description: 'Day of week for weekly (0=Sun … 6=Sat)',
  })
  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  dayOfWeek?: number;

  @ApiPropertyOptional({ description: 'End date (UTC) — stops expansion after this day' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}
