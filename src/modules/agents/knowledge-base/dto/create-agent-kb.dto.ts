import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  KB_CATEGORY_MAX,
  KB_CONTENT_MAX,
  KB_TITLE_MAX,
} from '../../validation/limits';

export class CreateAgentKbDto {
  @ApiProperty({ maxLength: KB_TITLE_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(KB_TITLE_MAX)
  title!: string;

  @ApiProperty({ maxLength: KB_CONTENT_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(KB_CONTENT_MAX)
  content!: string;

  @ApiPropertyOptional({ maxLength: KB_CATEGORY_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(KB_CATEGORY_MAX)
  category?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Required when the caller is SUPER_ADMIN; ignored for CLIENT callers. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
