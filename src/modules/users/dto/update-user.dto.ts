import { IsString, IsBoolean, IsOptional, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsString()
  @MinLength(2)
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional()
  @IsString()
  @MinLength(2)
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
