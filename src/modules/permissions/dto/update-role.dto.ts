import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class UpdateRoleDto {
  @ApiProperty({ example: 'COMPANY_ADMIN', description: 'Target `roles.name` value' })
  @IsString()
  @MinLength(1)
  newRoleName!: string;
}
