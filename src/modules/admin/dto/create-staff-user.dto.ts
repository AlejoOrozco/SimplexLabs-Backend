import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const STAFF_ADMIN_ROLES = ['COMPANY_ADMIN', 'COMPANY_STAFF'] as const;
export type AdminStaffRoleName = (typeof STAFF_ADMIN_ROLES)[number];

export class PermissionOverrideItemDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  permissionKey!: string;

  @ApiProperty()
  @IsBoolean()
  isGranted!: boolean;
}

export class CreateStaffUserDto {
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

  @ApiProperty({ enum: STAFF_ADMIN_ROLES })
  @IsIn(STAFF_ADMIN_ROLES)
  roleName!: AdminStaffRoleName;

  @ApiPropertyOptional({ type: [PermissionOverrideItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideItemDto)
  permissionOverrides?: PermissionOverrideItemDto[];
}
