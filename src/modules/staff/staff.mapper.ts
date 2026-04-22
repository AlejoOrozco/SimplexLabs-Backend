import type { Staff } from '@prisma/client';
import { StaffResponseDto } from './dto/staff-response.dto';

export function toStaffResponse(row: Staff): StaffResponseDto {
  return {
    id: row.id,
    companyId: row.companyId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
