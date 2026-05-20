import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendOnboardingCredentialsDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'One-time password shown only to the admin.' })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  companyName!: string;
}
