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
  @ApiProperty({ example: 'https://juanitosshoes.com' })
  @IsUrl({ require_protocol: true })
  url!: string;

  @ApiPropertyOptional({ example: 'Main store website' })
  @IsString()
  @MinLength(1)
  @IsOptional()
  label?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /** Required when the caller is SUPER_ADMIN; ignored when the caller is a CLIENT. */
  @ApiPropertyOptional({
    description: 'Required when called by SUPER_ADMIN',
  })
  @IsUUID()
  @IsOptional()
  companyId?: string;
}
