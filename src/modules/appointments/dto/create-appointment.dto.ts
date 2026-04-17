import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentType } from '@prisma/client';

export class CreateAppointmentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: AppointmentType })
  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @ApiProperty({ description: 'ISO 8601 datetime' })
  @IsDateString()
  scheduledAt!: string;

  @ApiPropertyOptional({ default: 30, minimum: 15 })
  @IsInt()
  @Min(15)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  contactId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  productId?: string;

  @ApiPropertyOptional()
  @IsUrl({ require_protocol: true })
  @IsOptional()
  meetingUrl?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(200)
  @IsOptional()
  externalAttendeeName?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  externalAttendeeEmail?: string;
}
