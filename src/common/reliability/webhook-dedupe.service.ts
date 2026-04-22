import { Injectable } from '@nestjs/common';
import { Prisma, WebhookEventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Claim-or-skip result returned by {@link WebhookDedupeService.claim}.
 *
 * - `claimed` : caller OWNS the event and MUST process it (or explicitly
 *   mark failure). The caller is also responsible for calling
 *   {@link WebhookDedupeService.markProcessed} or
 *   {@link WebhookDedupeService.markFailed} in the success/error path.
 * - `duplicate` : a prior successful claim exists (status PROCESSED or
 *   RECEIVED still in-flight). Caller MUST return 200 immediately and NOT
 *   perform any further work.
 */
export type WebhookClaim =
  | { claimed: true; id: string }
  | { claimed: false; reason: 'duplicate'; existingId: string };

/**
 * Narrow wrapper around the `webhook_events` dedupe table.
 *
 * Contract:
 *   - `claim()` does an INSERT keyed by `(provider, providerEventId)`. If
 *     the row already exists we receive a Prisma P2002 and surface it as
 *     `duplicate`. This is the ONLY safe dedupe primitive under
 *     concurrent webhook retries — a SELECT-then-INSERT loses the race
 *     and allows double-processing.
 *   - Downstream services MUST NOT consult this table for read purposes;
 *     the business tables (Message / PaymentEvent) remain the source of
 *     truth.
 */
@Injectable()
export class WebhookDedupeService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(params: {
    provider: string;
    providerEventId: string;
    companyId?: string | null;
  }): Promise<WebhookClaim> {
    try {
      const created = await this.prisma.webhookEvent.create({
        data: {
          provider: params.provider,
          providerEventId: params.providerEventId,
          companyId: params.companyId ?? null,
        },
        select: { id: true },
      });
      return { claimed: true, id: created.id };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.prisma.webhookEvent.findUnique({
          where: {
            provider_providerEventId: {
              provider: params.provider,
              providerEventId: params.providerEventId,
            },
          },
          select: { id: true },
        });
        return {
          claimed: false,
          reason: 'duplicate',
          existingId: existing?.id ?? 'unknown',
        };
      }
      throw error;
    }
  }

  async markProcessed(id: string, outcome: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: WebhookEventStatus.PROCESSED,
        outcome: truncate(outcome, 280),
        processedAt: new Date(),
      },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { id },
      data: {
        status: WebhookEventStatus.FAILED,
        outcome: truncate(error, 280),
        processedAt: new Date(),
      },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
