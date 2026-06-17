import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CalendarAdminScope {
  ALL = 'all',
  MINE = 'mine',
}

export class CalendarQueryDto {
  @ApiProperty({ description: 'ISO 8601 start of range (UTC)' })
  @IsDateString()
  start!: string;

  @ApiProperty({ description: 'ISO 8601 end of range (UTC)' })
  @IsDateString()
  end!: string;

  @ApiPropertyOptional({
    description: 'Filter by staff member id (`appointments.staff_id`)',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  staffMemberId?: string;

  @ApiPropertyOptional({
    description: 'Admin only: filter by company ID',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  companyId?: string;

  @ApiPropertyOptional({
    enum: CalendarAdminScope,
    description:
      'Admin scope: all companies vs events you organize or are invited to',
  })
  @IsEnum(CalendarAdminScope)
  @IsOptional()
  scope?: CalendarAdminScope;
}
