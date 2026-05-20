import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';

export class AddAttendeeDto {
  @ApiPropertyOptional({ description: 'Internal user to invite' })
  @ValidateIf((o: AddAttendeeDto) => !o.contactId)
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Client contact to invite' })
  @ValidateIf((o: AddAttendeeDto) => !o.userId)
  @IsUUID()
  contactId?: string;
}
