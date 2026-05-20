import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { EncryptionService } from './crypto/encryption.service';
import { SupabaseAdminService } from './supabase/supabase-admin.service';

/**
 * Shared cross-cutting providers.
 *
 * Guards referenced via `@UseGuards(Class)` must be resolvable from the
 * hosting module's DI container. Providing them here — with `@Global()` —
 * makes them injectable everywhere without each feature module having to
 * redeclare them.
 *
 * `EncryptionService` is also global so every module (channels, future
 * payments, etc.) can encrypt/decrypt sensitive values without re-wiring
 * providers.
 */
@Global()
@Module({
  providers: [
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    EncryptionService,
    SupabaseAdminService,
  ],
  exports: [
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    EncryptionService,
    SupabaseAdminService,
  ],
})
export class CommonModule {}
