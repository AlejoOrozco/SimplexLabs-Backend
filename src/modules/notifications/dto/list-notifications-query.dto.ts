import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/** Caps pagination so a rogue client can't DoS the list endpoint. */
const MAX_PAGE_SIZE = 100;

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    description:
      'Filter to unread notifications (readAt IS NULL). Accepts "true"/"false".',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  readonly unread?: boolean;

  @ApiPropertyOptional({
    description:
      'SUPER_ADMIN only: restrict cross-company listing to a single company.',
  })
  @IsOptional()
  @IsUUID()
  readonly companyId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: 25 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  readonly limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  readonly offset?: number;
}
