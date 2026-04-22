import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Channel } from '@prisma/client';

export class CreateChannelDto {
  @ApiProperty({ enum: Channel })
  @IsEnum(Channel)
  channel!: Channel;

  /**
   * Provider external id used by inbound webhooks to identify this channel.
   * For WhatsApp this is the `phone_number_id` from the Meta console.
   */
  @ApiProperty({ example: '1089903084203607' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalId!: string;

  @ApiPropertyOptional({
    description: 'Optional WhatsApp Business Account id (WABA).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  businessAccountId?: string;

  /**
   * Provider access token. Written encrypted; never returned in responses.
   */
  @ApiProperty({
    description: 'Long-lived provider access token. Stored encrypted.',
  })
  @IsString()
  @MinLength(10)
  accessToken!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Required when the caller is SUPER_ADMIN; ignored when the caller is a CLIENT. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
