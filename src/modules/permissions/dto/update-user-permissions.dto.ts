import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PermissionOverrideItemDto {
  @ApiProperty({ description: 'Permission key from the catalog' })
  @IsString()
  permissionKey!: string;

  @ApiProperty()
  @IsBoolean()
  isGranted!: boolean;
}

export class UpdateUserPermissionsDto {
  @ApiProperty({ type: [PermissionOverrideItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideItemDto)
  updates!: PermissionOverrideItemDto[];
}
