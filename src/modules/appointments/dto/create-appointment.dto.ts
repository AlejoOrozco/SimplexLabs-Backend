import {
  IsBoolean,
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

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional staff assignment (must belong to requester tenant).',
  })
  @IsUUID()
  @IsOptional()
  staffId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Required when the caller is SUPER_ADMIN — the client company this appointment belongs to (e.g. SimplexLabs ↔ client `SIMPLEX_WITH_CLIENT`).',
  })
  @IsUUID()
  @IsOptional()
  companyId?: string;

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

  @ApiPropertyOptional({
    description:
      'Optional override; otherwise set from the creator user timezone on create.',
  })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  creatorTimezone?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @ApiPropertyOptional({ description: 'RRULE string when part of a series' })
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  recurrenceRule?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  recurrenceParentId?: string;

  @ApiPropertyOptional({ description: 'Series end (UTC)' })
  @IsDateString()
  @IsOptional()
  recurrenceEndDate?: string;
}
