import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class AttendeeSearchQueryDto {
  @ApiPropertyOptional({ description: 'Minimum 2 characters' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  q?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}
