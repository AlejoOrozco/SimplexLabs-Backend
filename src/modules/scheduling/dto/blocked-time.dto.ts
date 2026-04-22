import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateBlockedTimeDto {
  @ApiPropertyOptional({
    description:
      'Staff-specific block. Omit for a company-wide block (e.g. holiday).',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class BlockedTimeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() companyId!: string;
  @ApiPropertyOptional({ nullable: true }) staffId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) startsAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) endsAt!: Date;
  @ApiPropertyOptional({ nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class ListBlockedTimesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  staffId?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
