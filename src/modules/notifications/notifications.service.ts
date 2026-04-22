import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationChannel,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { scopedCompanyWhere } from '../../common/tenant/tenant-scope';
import { resolvePagination } from '../../common/http/pagination';
import type { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import type {
  NotificationListResponseDto,
  NotificationResponseDto,
} from './dto/notification-response.dto';
import {
  notificationInclude,
  toNotificationResponse,
  type NotificationWithRelations,
} from './notification.mapper';
import { EmailService } from './adapters/email.service';
import { WhatsappNotificationAdapter } from './adapters/whatsapp-notification.adapter';

/**
 * Input accepted by the internal `create()` API. Callers (pipeline,
 * payments, appointments) provide the business context; NotificationsService
 * owns persistence + delivery orchestration.
 *
 * `payload` is an opaque JSON hint for the dashboard (e.g. link back to a
 * payment or conversation). It MUST NOT include secrets, tokens, or any
 * field that could leak PII beyond what is already in the conversation.
 */
export interface CreateNotificationParams {
  readonly companyId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly conversationId?: string | null;
  readonly payload?: Record<string, unknown> | null;
  /**
   * When provided, an outbound attempt sequence is kicked off:
   *   1. WhatsApp (if `companySettings.notificationWhatsapp` is set)
   *   2. Email fallback (only if WhatsApp failed AND email is configured)
   *
   * Use `false` for low-priority, in-app-only notifications.
   * Default: `true`.
   */
  readonly deliverExternal?: boolean;
}

/**
 * Delivery policy summary (Phase 6):
 *
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │ 1. IN_APP   : always persisted, NotificationDelivery row created.  │
 *   │ 2. WHATSAPP : attempted iff company has `notificationWhatsapp`;    │
 *   │               delivery row records sent/failed + error summary.    │
 *   │ 3. EMAIL    : attempted ONLY when WhatsApp failed (or was skipped  │
 *   │               because unconfigured) AND email is configured.       │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Every attempt — including skipped (no destination) — is recorded as a
 * `NotificationDelivery` row so the audit trail is deterministic. This
 * keeps the operational UI ("delivered / failed / skipped per channel")
 * truthful without any heuristics.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly whatsapp: WhatsappNotificationAdapter,
    private readonly email: EmailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Internal: business flows call this to surface an actionable event.
  // ---------------------------------------------------------------------------

  async create(
    params: CreateNotificationParams,
  ): Promise<NotificationResponseDto> {
    const payload = this.sanitizePayload(params.payload ?? null);

    const created = await this.prisma.notification.create({
      data: {
        companyId: params.companyId,
        conversationId: params.conversationId ?? null,
        type: params.type,
        title: params.title,
        body: params.body,
        payload: payload ?? Prisma.JsonNull,
      },
      select: { id: true },
    });

    const settings = await this.prisma.companySettings.findUnique({
      where: { companyId: params.companyId },
      select: {
        notificationWhatsapp: true,
        notificationEmail: true,
        inAppNotificationsEnabled: true,
      },
    });

    // 1) IN_APP always (operators MUST see it even when IN_APP is toggled
    // off — the toggle just suppresses realtime pushes, never persistence).
    await this.recordDelivery({
      notificationId: created.id,
      channel: NotificationChannel.IN_APP,
      destination: params.companyId,
      success: true,
      providerRefId: null,
      error: null,
    });

    // 2) External delivery attempts (optional).
    const shouldDeliverExternal = params.deliverExternal ?? true;
    if (shouldDeliverExternal) {
      await this.runExternalDelivery({
        notificationId: created.id,
        companyId: params.companyId,
        whatsappTo: settings?.notificationWhatsapp ?? null,
        emailTo: settings?.notificationEmail ?? null,
        subject: params.title,
        body: params.body,
      });
    }

    const fresh = await this.loadById(created.id);
    const dto = toNotificationResponse(fresh);

    if (settings?.inAppNotificationsEnabled !== false) {
      this.realtime.emitNotificationCreated({
        id: dto.id,
        companyId: dto.companyId,
        conversationId: dto.conversationId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        payload: dto.payload,
        readAt: dto.readAt,
        createdAt: dto.createdAt,
      });
    }

    return dto;
  }

  // ---------------------------------------------------------------------------
  // Read APIs (tenant-scoped + SUPER_ADMIN cross-company)
  // ---------------------------------------------------------------------------

  async findAll(
    requester: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponseDto> {
    const scope = scopedCompanyWhere(requester);
    const where: Prisma.NotificationWhereInput = {};
    if (scope.companyId) {
      where.companyId = scope.companyId;
    } else if (requester.role === 'SUPER_ADMIN' && query.companyId) {
      // Cross-company reads are ADMIN-only; a non-admin passing companyId
      // would have already been narrowed to their own scope above.
      where.companyId = query.companyId;
    }
    if (query.unread === true) where.readAt = null;

    const { limit, offset } = resolvePagination({
      limit: query.limit,
      offset: query.offset,
    });

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: notificationInclude,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    return {
      items: rows.map(toNotificationResponse),
      total,
      unreadCount,
    };
  }

  async findOne(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    const row = await this.loadForRequester(id, requester);
    return toNotificationResponse(row);
  }

  async markRead(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<NotificationResponseDto> {
    await this.loadForRequester(id, requester);
    // Compare-and-swap: only flip readAt when currently unread, so
    // concurrent calls don't overwrite the first read timestamp.
    await this.prisma.notification.updateMany({
      where: { id, readAt: null },
      data: { readAt: new Date() },
    });
    const fresh = await this.loadById(id);
    return toNotificationResponse(fresh);
  }

  async markAllRead(
    requester: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    const scope = scopedCompanyWhere(requester);
    // SUPER_ADMIN must explicitly call per-company to avoid accidentally
    // acknowledging every tenant's notifications at once. For a CLIENT,
    // scope enforces their companyId.
    if (!scope.companyId && requester.role === 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'SUPER_ADMIN mark-all-read requires an explicit companyId filter; use the per-notification endpoint instead.',
      );
    }
    const result = await this.prisma.notification.updateMany({
      where: {
        companyId: scope.companyId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  // ---------------------------------------------------------------------------
  // Private: delivery orchestration
  // ---------------------------------------------------------------------------

  private async runExternalDelivery(args: {
    notificationId: string;
    companyId: string;
    whatsappTo: string | null;
    emailTo: string | null;
    subject: string;
    body: string;
  }): Promise<void> {
    const whatsappOutcome = await this.attemptWhatsapp({
      notificationId: args.notificationId,
      companyId: args.companyId,
      to: args.whatsappTo,
      text: `${args.subject}\n\n${args.body}`,
    });

    if (whatsappOutcome === 'sent') return;

    // Either skipped (no destination) or failed — fall back to email.
    await this.attemptEmail({
      notificationId: args.notificationId,
      to: args.emailTo,
      subject: args.subject,
      body: args.body,
      whatsappStatus: whatsappOutcome,
    });
  }

  private async attemptWhatsapp(args: {
    notificationId: string;
    companyId: string;
    to: string | null;
    text: string;
  }): Promise<'sent' | 'failed' | 'skipped'> {
    if (!args.to) {
      await this.recordDelivery({
        notificationId: args.notificationId,
        channel: NotificationChannel.WHATSAPP,
        destination: '',
        success: false,
        providerRefId: null,
        error: 'whatsapp_destination_not_configured',
      });
      return 'skipped';
    }

    const result = await this.whatsapp.send({
      companyId: args.companyId,
      to: args.to,
      text: args.text,
    });
    await this.recordDelivery({
      notificationId: args.notificationId,
      channel: NotificationChannel.WHATSAPP,
      destination: args.to,
      success: result.success,
      providerRefId: result.providerRefId,
      error: result.error,
    });
    return result.success ? 'sent' : 'failed';
  }

  private async attemptEmail(args: {
    notificationId: string;
    to: string | null;
    subject: string;
    body: string;
    whatsappStatus: 'failed' | 'skipped';
  }): Promise<void> {
    if (!args.to) {
      await this.recordDelivery({
        notificationId: args.notificationId,
        channel: NotificationChannel.EMAIL,
        destination: '',
        success: false,
        providerRefId: null,
        error: 'email_destination_not_configured',
      });
      return;
    }
    if (!this.email.isConfigured()) {
      await this.recordDelivery({
        notificationId: args.notificationId,
        channel: NotificationChannel.EMAIL,
        destination: args.to,
        success: false,
        providerRefId: null,
        error: 'email_provider_not_configured',
      });
      return;
    }

    const result = await this.email.send({
      to: args.to,
      subject: `[Simplex] ${args.subject}`,
      text:
        args.whatsappStatus === 'failed'
          ? `${args.body}\n\n(Sent as email fallback — WhatsApp delivery failed.)`
          : args.body,
    });
    await this.recordDelivery({
      notificationId: args.notificationId,
      channel: NotificationChannel.EMAIL,
      destination: args.to,
      success: result.success,
      providerRefId: result.providerRefId,
      error: result.error,
    });
  }

  private async recordDelivery(args: {
    notificationId: string;
    channel: NotificationChannel;
    destination: string;
    success: boolean;
    providerRefId: string | null;
    error: string | null;
  }): Promise<void> {
    const now = new Date();
    try {
      await this.prisma.notificationDelivery.create({
        data: {
          notificationId: args.notificationId,
          channel: args.channel,
          destination: args.destination,
          sentAt: args.success ? now : null,
          failedAt: args.success ? null : now,
          errorMessage: args.error,
          providerRefId: args.providerRefId,
        },
      });
    } catch (error) {
      // Delivery audit failures must NEVER mask the notification itself.
      // Log and continue so the in-app row is still visible.
      this.logger.error(
        `Failed to persist NotificationDelivery notification=${args.notificationId} channel=${args.channel}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private: access + load helpers
  // ---------------------------------------------------------------------------

  private async loadById(id: string): Promise<NotificationWithRelations> {
    return this.prisma.notification.findUniqueOrThrow({
      where: { id },
      include: notificationInclude,
    });
  }

  private async loadForRequester(
    id: string,
    requester: AuthenticatedUser,
  ): Promise<NotificationWithRelations> {
    const row = await this.prisma.notification.findUnique({
      where: { id },
      include: notificationInclude,
    });
    if (!row) {
      throw new NotFoundException('Notification not found');
    }
    if (
      requester.role !== 'SUPER_ADMIN' &&
      row.companyId !== requester.companyId
    ) {
      // Same 404 shape so cross-tenant probing doesn't reveal existence.
      throw new NotFoundException('Notification not found');
    }
    return row;
  }

  /**
   * Scrub out any obviously-sensitive keys before we let a payload reach
   * the DB. The list is conservative — trigger callers should already
   * avoid these, but defense-in-depth keeps accidents out of audit logs
   * and realtime broadcasts.
   */
  private sanitizePayload(
    payload: Record<string, unknown> | null,
  ): Prisma.InputJsonValue | null {
    if (!payload) return null;
    const SENSITIVE = new Set([
      'password',
      'token',
      'accessToken',
      'apiKey',
      'secret',
      'authorization',
      'cookie',
      'email',
      'phone',
    ]);
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (SENSITIVE.has(key)) continue;
      clean[key] = value;
    }
    return JSON.parse(JSON.stringify(clean)) as Prisma.InputJsonValue;
  }
}
