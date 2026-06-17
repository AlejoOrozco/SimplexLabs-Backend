import { Roles } from './roles.decorator';
import { TENANT_ROLES } from '../auth/user-role.util';

/** Allows SUPER_ADMIN plus all company-scoped tenant roles. */
export const TenantRoles = () =>
  Roles('SUPER_ADMIN', ...TENANT_ROLES);
