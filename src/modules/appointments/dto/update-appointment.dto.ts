import { IsEnum, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { AppointmentStatus } from '@prisma/client';
import { CreateAppointmentDto } from './create-appointment.dto';

export class UpdateAppointmentDto extends PartialType(
  OmitType(CreateAppointmentDto, ['recurrenceParentId'] as const),
) {
  @ApiPropertyOptional({ enum: AppointmentStatus })
  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    nullable: true,
    format: 'uuid',
    description: 'Set to null to detach from a recurrence parent',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsUUID()
  recurrenceParentId?: string | null;
}
