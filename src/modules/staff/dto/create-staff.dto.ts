import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class CreateStaffDto {
  @ApiProperty({ minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  firstName!: string;

  @ApiProperty({ minLength: 1, maxLength: 60 })
  @IsString()
  @Length(1, 60)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'E.164 or local phone format; stored as-is',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[+0-9 ()-]{5,20}$/, {
    message: 'phone must be 5–20 chars of digits, space, +, -, or parentheses',
  })
  phone?: string;

  @ApiPropertyOptional({ enum: StaffRole, default: StaffRole.EMPLOYEE })
  @IsOptional()
  @IsEnum(StaffRole)
  role?: StaffRole;
}
