import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWebsiteDto {
  @ApiProperty({ example: 'https://example.com' })
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiPropertyOptional()
  @IsString()
  @MinLength(1)
  @IsOptional()
  label?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** Required when the caller is SUPER_ADMIN; ignored when the caller is a CLIENT. */
  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  companyId?: string;
}
