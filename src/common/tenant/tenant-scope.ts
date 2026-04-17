import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Shared helpers for tenant (company-scoped) resources.
 *
 * Every tenant-scoped service should use these instead of re-implementing the
 * same company filter / ownership check / companyId resolution in each module.
 */

export interface TenantScope {
  companyId?: string;
}

/**
 * Returns a Prisma `where` fragment that scopes a query to the requester's company.
 * `SUPER_ADMIN` gets `{}` (cross-tenant read).
 * A `CLIENT` without a companyId is rejected with `ForbiddenException`.
 */
export function scopedCompanyWhere(requester: AuthenticatedUser): TenantScope {
  if (requester.role === 'SUPER_ADMIN') return {};
  if (!requester.companyId) {
    throw new ForbiddenException('Requester has no company scope');
  }
  return { companyId: requester.companyId };
}

/**
 * Throws `ForbiddenException` when a non-admin requester tries to access a
 * record that does not belong to their company.
 */
export function assertTenantAccess(
  targetCompanyId: string,
  requester: AuthenticatedUser,
): void {
  if (requester.role === 'SUPER_ADMIN') return;
  if (targetCompanyId !== requester.companyId) {
    throw new ForbiddenException('Access denied');
  }
}

/**
 * Resolves the `companyId` to use on a create operation:
 * - `SUPER_ADMIN`: must explicitly provide one in the DTO.
 * - `CLIENT`: always uses their own `companyId`; any `providedCompanyId` is ignored.
 */
export function resolveCompanyId(
  requester: AuthenticatedUser,
  providedCompanyId: string | undefined,
): string {
  if (requester.role === 'SUPER_ADMIN') {
    if (!providedCompanyId) {
      throw new BadRequestException(
        'companyId is required when creating as SUPER_ADMIN',
      );
    }
    return providedCompanyId;
  }
  if (!requester.companyId) {
    throw new ForbiddenException('Requester has no company scope');
  }
  return requester.companyId;
}
