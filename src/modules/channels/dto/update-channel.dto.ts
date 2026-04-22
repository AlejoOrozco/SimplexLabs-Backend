import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Note: `channel` and `externalId` are deliberately NOT updatable. They
 * identify the row from the inbound-webhook perspective; changing them
 * means "create a new channel and deactivate the old one".
 */
export class UpdateChannelDto {
  @ApiPropertyOptional({
    description: 'Rotate the provider access token. Stored encrypted.',
  })
  @IsOptional()
  @IsString()
  @MinLength(10)
  accessToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  businessAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
