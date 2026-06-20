import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/** Company-scoped dashboard roles (not platform operators). */
export const TENANT_ROLES = [
  'CLIENT',
  'COMPANY_ADMIN',
  'COMPANY_STAFF',
] as const;

export type TenantRoleName = (typeof TENANT_ROLES)[number];

const TENANT_ROLE_SET = new Set<string>(TENANT_ROLES);

/** Roles that may be assigned when a COMPANY_ADMIN creates users in their tenant. */
export const TENANT_CREATABLE_ROLES = ['COMPANY_STAFF', 'CLIENT'] as const;

const PLATFORM_PRIVILEGED_ROLES = new Set(['SUPER_ADMIN', 'SIMPLEX_STAFF']);

export function isTenantRoleName(roleName: string): roleName is TenantRoleName {
  return TENANT_ROLE_SET.has(roleName);
}

export function isTenantUser(requester: AuthenticatedUser): boolean {
  return requester.companyId != null && isTenantRoleName(requester.roleName);
}

export function isCompanyAdmin(requester: AuthenticatedUser): boolean {
  return requester.roleName === 'COMPANY_ADMIN';
}

/**
 * Platform operator with global or platform-owner-company scope.
 * When `isPlatformOwnerCompany` is omitted, only checks the role name (JWT path).
 */
export function isPlatformSuperAdmin(
  requester: AuthenticatedUser,
  isPlatformOwnerCompany?: boolean,
): boolean {
  if (requester.roleName !== 'SUPER_ADMIN') {
    return false;
  }
  if (isPlatformOwnerCompany === undefined) {
    return true;
  }
  if (requester.companyId == null) {
    return true;
  }
  return isPlatformOwnerCompany;
}

export function isPlatformPrivilegedRole(roleName: string): boolean {
  return PLATFORM_PRIVILEGED_ROLES.has(roleName);
}
