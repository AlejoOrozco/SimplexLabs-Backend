import {
  IsEmail,
  IsString,
  IsOptional,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  lastName!: string;

  @ApiProperty({
    example: 'CLIENT',
    description: 'Must match an existing `roles.name` row',
  })
  @IsString()
  @MinLength(2)
  roleName!: string;

  @ApiPropertyOptional()
  @IsUUID()
  @IsOptional()
  companyId?: string;
}
