import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createClient } from '@supabase/supabase-js';
import { parse as parseCookie } from 'node:querystring';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { companyRoom } from './realtime-events';

interface AuthedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
  };
}

/**
 * Socket.IO gateway at `/realtime`.
 *
 * Authentication:
 *   - Reads the `access_token` cookie sent with the WebSocket upgrade
 *     (same cookie used for HTTP routes).
 *   - Verifies it via Supabase and hydrates the DB user.
 *   - Stores the hydrated `AuthenticatedUser` on `socket.data.user`.
 *
 * Room strategy:
 *   - On successful connect, the socket auto-joins `company:{companyId}`.
 *   - Tenant isolation is enforced by ONLY emitting to that room.
 *     Sockets never receive events for other tenants because they are
 *     never joined to foreign rooms.
 *   - SUPER_ADMIN joins nothing by default — a later phase can add an
 *     explicit opt-in subscription model if cross-tenant admin streams
 *     are needed.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const user = await this.authenticate(client);
      client.data.user = user;

      if (user.companyId) {
        await client.join(companyRoom(user.companyId));
      }

      this.logger.log(
        `Realtime connected socket=${client.id} user=${user.id} company=${user.companyId ?? 'none'}`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'authentication failed';
      this.logger.warn(
        `Realtime connection rejected socket=${client.id}: ${message}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket): void {
    const userId = client.data.user?.id ?? 'anonymous';
    this.logger.log(
      `Realtime disconnected socket=${client.id} user=${userId}`,
    );
  }

  private async authenticate(client: Socket): Promise<AuthenticatedUser> {
    const rawCookie =
      (client.handshake.headers.cookie as string | undefined) ?? '';
    const token = extractAccessToken(rawCookie);
    if (!token) {
      throw new Error('missing access_token cookie');
    }

    const supabaseUrl = this.config.getOrThrow<string>('supabase.url');
    const serviceRoleKey = this.config.getOrThrow<string>(
      'supabase.serviceRoleKey',
    );

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      throw new Error('invalid or expired token');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { supabaseId: data.user.id },
      select: {
        id: true,
        supabaseId: true,
        email: true,
        role: true,
        companyId: true,
        isActive: true,
      },
    });

    if (!dbUser || !dbUser.isActive) {
      throw new Error('user not found or inactive');
    }

    return {
      id: dbUser.id,
      supabaseId: dbUser.supabaseId,
      email: dbUser.email,
      role: dbUser.role,
      companyId: dbUser.companyId,
    };
  }
}

/**
 * Parses the raw `Cookie` header into a single `access_token` value.
 * Uses `querystring.parse` with `; ` delimiters rather than pulling in
 * a dependency — Socket.IO's handshake exposes headers as a plain string.
 */
function extractAccessToken(rawCookie: string): string | null {
  if (!rawCookie) return null;
  const parsed = parseCookie(rawCookie, '; ', '=');
  const raw = parsed['access_token'];
  if (typeof raw !== 'string') return null;
  // Cookie values may be URL-encoded by browsers.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
