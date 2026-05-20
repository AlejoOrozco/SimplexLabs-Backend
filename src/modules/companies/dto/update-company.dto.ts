import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Niche } from '@prisma/client';

export class UpdateCompanyDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(2)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ enum: Niche, description: 'SUPER_ADMIN only' })
  @IsEnum(Niche)
  @IsOptional()
  niche?: Niche;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({
    description: 'Stored on company settings as notification WhatsApp number',
  })
  @IsString()
  @IsOptional()
  notificationPhone?: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  notificationEmail?: string;

  @ApiPropertyOptional({
    description:
      'SUPER_ADMIN only; channel rows still require POST /channels with a token',
  })
  @IsString()
  @IsOptional()
  whatsappPhoneNumberId?: string;

  @ApiPropertyOptional({
    description:
      'SUPER_ADMIN only; channel rows still require POST /channels with a token',
  })
  @IsString()
  @IsOptional()
  whatsappPhoneNumber?: string;
}
