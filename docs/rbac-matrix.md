# RBAC permission matrix

Canonical keys live in `src/common/auth/permission-keys.ts`. Enforcement uses `@RequirePermissions` plus `PermissionsGuard`; tenant routes also use `@TenantRoles()` where role behavior differs.

## Roles

| Role | Scope | Default permissions |
|------|--------|---------------------|
| `SUPER_ADMIN` | Platform owner company (`is_platform_owner`) | All keys via `resolvePermissions`; tenant routes use `/admin/*` for cross-company reads |
| `COMPANY_ADMIN` | Own `companyId` | All `company.*` keys (code + DB seed) |
| `COMPANY_STAFF` | Own `companyId` | DB `role_permissions` view defaults; overrides in `user_permissions` |
| `CLIENT` | Own `companyId` | DB read/manage defaults for operations; no `company.users.manage` or `company.users.permissions` |

## Tenant API access

Controllers that previously allowed only `CLIENT` now use `@TenantRoles()` (`SUPER_ADMIN` + `CLIENT` + `COMPANY_ADMIN` + `COMPANY_STAFF`), with fine-grained checks via permission keys.

## Seeding

Run `prisma migrate deploy` (or `prisma migrate dev`) so migration `20260528120000_rbac_tenant_roles` applies `role_permissions` defaults.
