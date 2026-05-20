import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateClientUserDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  lastName!: string;
}
