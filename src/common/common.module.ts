import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { EncryptionService } from './crypto/encryption.service';

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
  providers: [JwtAuthGuard, RolesGuard, EncryptionService],
  exports: [JwtAuthGuard, RolesGuard, EncryptionService],
})
export class CommonModule {}
