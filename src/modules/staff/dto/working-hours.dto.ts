import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateWorkingHoursDto {
  @ApiProperty({
    description: '0 = Sunday, 6 = Saturday',
    minimum: 0,
    maximum: 6,
  })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00', description: 'Local "HH:mm" start' })
  @Matches(HHMM, { message: 'startTime must be HH:mm (00:00 – 23:59)' })
  startTime!: string;

  @ApiProperty({ example: '17:30', description: 'Local "HH:mm" end' })
  @Matches(HHMM, { message: 'endTime must be HH:mm (00:00 – 23:59)' })
  endTime!: string;
}

export class WorkingHoursResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() staffId!: string;
  @ApiProperty() dayOfWeek!: number;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}
