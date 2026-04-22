import { ApiProperty } from '@nestjs/swagger';
import type {
  AppointmentStatus,
  AppointmentType,
  ProductType,
  StaffRole,
} from '@prisma/client';

export class AppointmentOrganizerDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;
}

export class AppointmentContactSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;
}

export class AppointmentProductSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ['PRODUCT', 'SERVICE'] })
  type!: ProductType;

  @ApiProperty({ description: 'Decimal serialized as string' })
  price!: string;
}

export class AppointmentStaffSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: ['OWNER', 'EMPLOYEE'] })
  role!: StaffRole;
}

export class AppointmentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  companyId!: string;

  @ApiProperty()
  organizerId!: string;

  @ApiProperty({ type: String, nullable: true })
  contactId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  productId!: string | null;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({
    enum: ['SIMPLEX_WITH_CLIENT', 'CLIENT_WITH_CONTACT', 'EXTERNAL'],
  })
  type!: AppointmentType;

  @ApiProperty({
    enum: ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'],
  })
  status!: AppointmentStatus;

  @ApiProperty()
  scheduledAt!: Date;

  @ApiProperty()
  durationMinutes!: number;

  @ApiProperty({ type: String, nullable: true })
  meetingUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  externalAttendeeName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  externalAttendeeEmail!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: AppointmentOrganizerDto })
  organizer!: AppointmentOrganizerDto;

  @ApiProperty({ type: AppointmentContactSummaryDto, nullable: true })
  contact!: AppointmentContactSummaryDto | null;

  @ApiProperty({ type: AppointmentProductSummaryDto, nullable: true })
  product!: AppointmentProductSummaryDto | null;

  @ApiProperty({ type: String, nullable: true })
  staffId!: string | null;

  @ApiProperty({ type: AppointmentStaffSummaryDto, nullable: true })
  staff!: AppointmentStaffSummaryDto | null;
}
