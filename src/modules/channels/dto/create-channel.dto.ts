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
   * For Twilio WhatsApp: the sender number in `whatsapp:+E164` form.
   */
  @ApiProperty({ example: 'whatsapp:+14155238886' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  externalId!: string;

  @ApiPropertyOptional({
    description: 'Optional Twilio Account SID (defaults to TWILIO_ACCOUNT_SID).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  businessAccountId?: string;

  /**
   * Provider auth token. For Twilio: Auth Token. Stored encrypted.
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
