import { Global, Module } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Shared cross-cutting providers.
 *
 * Guards referenced via `@UseGuards(Class)` must be resolvable from the
 * hosting module's DI container. Providing them here — with `@Global()` —
 * makes them injectable everywhere without each feature module having to
 * redeclare them.
 */
@Global()
@Module({
  providers: [JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard],
})
export class CommonModule {}
