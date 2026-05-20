import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AttendeeUserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  roleName!: string;

  @ApiPropertyOptional()
  company?: { id: string; name: string };
}

export class AttendeeContactSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  email!: string | null;

  @ApiPropertyOptional()
  company?: { id: string; name: string };
}

export class AttendeeResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  appointmentId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  userId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactId!: string | null;

  @ApiProperty()
  invitationStatus!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  respondedAt!: string | null;

  @ApiPropertyOptional({ type: () => AttendeeUserSummaryDto })
  user?: AttendeeUserSummaryDto | null;

  @ApiPropertyOptional({ type: () => AttendeeContactSummaryDto })
  contact?: AttendeeContactSummaryDto | null;
}
