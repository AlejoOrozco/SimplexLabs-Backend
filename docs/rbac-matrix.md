# RBAC permission matrix

Canonical keys live in `src/common/auth/permission-keys.ts`. Enforcement uses `@RequirePermissions` plus `PermissionsGuard` on every protected route.

## Roles

| Role | Scope | Default permissions |
|------|--------|---------------------|
| `SUPER_ADMIN` | Platform owner company (`is_platform_owner`) | All `platform.*` keys; all `company.*` keys when on the platform-owner company |
| `SIMPLEX_STAFF` | Platform (via DB `role_permissions`) | Configurable platform keys from DB defaults + overrides |
| `COMPANY_ADMIN` | Own `companyId` | All `company.*` keys (code + DB seed) |
| `COMPANY_STAFF` | Own `companyId` | DB `role_permissions` view defaults; overrides in `user_permissions` |
| `CLIENT` | Own `companyId` | DB read/manage defaults for operations; no `company.users.manage` or `company.users.permissions` |

## Tenant API access

Tenant controllers use `@RequirePermissions(PERM.company*)` only. Role membership no longer gates HTTP routes — permissions do.

Platform admin surfaces (`/admin/*`, subscription mutations, plan CRUD) use `platform.admin.access` or other `platform.*` keys.

## Seeding

Run `prisma migrate deploy` (or `prisma migrate dev`) so migration `20260528120000_rbac_tenant_roles` applies `role_permissions` defaults.
