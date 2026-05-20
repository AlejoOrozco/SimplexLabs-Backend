import { IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MoveAppointmentDto {
  @ApiProperty({ description: 'New start time in UTC ISO 8601' })
  @IsDateString()
  newStart!: string;

  @ApiProperty({ description: 'New end time in UTC ISO 8601' })
  @IsDateString()
  newEnd!: string;
}
