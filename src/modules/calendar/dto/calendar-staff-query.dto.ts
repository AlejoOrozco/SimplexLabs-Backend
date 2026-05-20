import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CalendarStaffQueryDto {
  @ApiPropertyOptional({
    description: 'Company to list staff for (required when caller is SUPER_ADMIN)',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  companyId?: string;
}
