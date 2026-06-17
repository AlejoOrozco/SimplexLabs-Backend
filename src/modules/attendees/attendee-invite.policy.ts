import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import {
  isCompanyAdmin,
  isPlatformPrivilegedRole,
  isPlatformSuperAdmin,
} from '../../common/auth/user-role.util';

export interface AttendeeInviteTarget {
  readonly id: string;
  readonly roleName: string;
  readonly companyId: string | null;
  readonly isPlatformOwnerCompany: boolean;
}

function isInvitePrivilegedRequester(requester: AuthenticatedUser): boolean {
  return (
    isPlatformSuperAdmin(requester, requester.isPlatformOwnerCompany) ||
    requester.roleName === 'SIMPLEX_STAFF'
  );
}

/**
 * Who may be invited to an appointment:
 * - SUPER_ADMIN / SIMPLEX_STAFF: anyone
 * - COMPANY_ADMIN: platform operators + same-company users except other COMPANY_ADMIN
 * - Other tenant users: only COMPANY_ADMIN from their own company
 */
export function assertCanInviteAttendeeUser(
  requester: AuthenticatedUser,
  target: AttendeeInviteTarget,
  appointmentCompanyId: string,
): void {
  if (target.id === requester.id) {
    throw new ForbiddenException('You cannot invite yourself');
  }

  if (isInvitePrivilegedRequester(requester)) {
    return;
  }

  if (isCompanyAdmin(requester)) {
    if (target.isPlatformOwnerCompany && isPlatformPrivilegedRole(target.roleName)) {
      return;
    }

    if (target.roleName === 'COMPANY_ADMIN') {
      throw new ForbiddenException(
        'Company admins cannot invite other company admins',
      );
    }

    if (target.companyId === appointmentCompanyId) {
      return;
    }

    if (target.isPlatformOwnerCompany) {
      return;
    }

    throw new ForbiddenException(
      `User ${target.id} cannot be invited to this appointment`,
    );
  }

  if (
    target.roleName === 'COMPANY_ADMIN' &&
    target.companyId != null &&
    target.companyId === requester.companyId
  ) {
    return;
  }

  throw new ForbiddenException('You can only invite your company admins');
}

export function canSearchAttendeeUser(
  requester: AuthenticatedUser,
  target: Pick<AttendeeInviteTarget, 'roleName' | 'companyId' | 'isPlatformOwnerCompany'>,
): boolean {
  if (isInvitePrivilegedRequester(requester)) {
    return true;
  }

  if (isCompanyAdmin(requester)) {
    if (target.isPlatformOwnerCompany && isPlatformPrivilegedRole(target.roleName)) {
      return true;
    }
    if (target.roleName === 'COMPANY_ADMIN') {
      return false;
    }
    if (target.companyId === requester.companyId) {
      return true;
    }
    return target.isPlatformOwnerCompany;
  }

  return (
    target.roleName === 'COMPANY_ADMIN' &&
    target.companyId != null &&
    target.companyId === requester.companyId
  );
}
