import type { AuthenticatedUser } from '../decorators/current-user.decorator';

export function isSuperAdmin(requester: AuthenticatedUser): boolean {
  return (
    requester.roleName === 'SUPER_ADMIN'
  );
}
