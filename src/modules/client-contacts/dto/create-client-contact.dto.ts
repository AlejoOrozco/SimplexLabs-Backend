import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContactSource } from '@prisma/client';

export class CreateClientContactDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  lastName!: string;

  @ApiPropertyOptional()
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ enum: ContactSource })
  @IsEnum(ContactSource)
  source!: ContactSource;

  /** Required when the caller is SUPER_ADMIN; ignored when the caller is a CLIENT. */
  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  companyId?: string;
}
