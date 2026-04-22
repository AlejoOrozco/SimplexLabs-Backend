import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

/**
 * Custom Socket.IO adapter that injects the same CORS policy used by
 * the HTTP layer. Without this, `@WebSocketGateway({ cors: ... })` can
 * only hold static strings because decorators execute before the Nest
 * container is built (ConfigService isn't yet available).
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: string[],
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    const merged: Partial<ServerOptions> = {
      ...(options ?? {}),
      cors: {
        origin: this.allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST'],
      },
    };
    return super.createIOServer(port, merged as ServerOptions);
  }
}
