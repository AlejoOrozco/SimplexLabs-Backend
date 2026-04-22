import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateStaffDto } from './create-staff.dto';

export class UpdateStaffDto extends PartialType(CreateStaffDto) {
  @ApiPropertyOptional({
    description:
      'Deactivate with `false`. Deactivated staff are excluded from availability and from agent booking candidates.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
