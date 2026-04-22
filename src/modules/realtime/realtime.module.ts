import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Global-ish realtime primitives. Any feature module that needs to emit
 * a client-facing event should import `RealtimeModule` and inject
 * `RealtimeService` — never the gateway directly.
 */
@Module({
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
