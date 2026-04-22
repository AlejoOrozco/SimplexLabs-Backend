import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  KB_CATEGORY_MAX,
  KB_CONTENT_MAX,
  KB_TITLE_MAX,
} from '../../validation/limits';

export class UpdateAgentKbDto {
  @ApiPropertyOptional({ maxLength: KB_TITLE_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(KB_TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ maxLength: KB_CONTENT_MAX })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(KB_CONTENT_MAX)
  content?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: KB_CATEGORY_MAX,
    description: 'Pass null to clear the category.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(KB_CATEGORY_MAX)
  category?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
