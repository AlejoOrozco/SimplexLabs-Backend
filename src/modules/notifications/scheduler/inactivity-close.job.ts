import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  Channel,
  ConversationControlMode,
  ConversationLifecycleStatus,
  ConvoStatus,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ConversationLifecycleService } from '../../conversations/conversation-lifecycle.service';
import { MetaSenderService } from '../../webhooks/meta-sender.service';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  messageEventSelect,
  toMessageEventPayload,
} from '../../realtime/realtime-payload.mapper';
import type { NotificationsConfig } from '../../../config/configuration';

const JOB_NAME = 'notifications.inactivity-close';

/**
 * Phase 6 inactivity auto-close job.
 *
 * Eligibility (ALL must hold):
 *   - Conversation.status = OPEN
 *   - Conversation.controlMode = AGENT (never close HUMAN-controlled threads)
 *   - Conversation.lifecycleStatus ≠ AUTO_CLOSED_INACTIVE (idempotency)
 *   - lastCustomerMessageAt (or createdAt when null) older than the company's
 *     `inactivityCloseHours` threshold
 *
 * Concurrency safety:
 *   - A process-local mutex (`inFlight`) prevents the same node instance
 *     from running two overlapping cycles if a run ever takes longer than
 *     the cron tick.
 *   - Each conversation is transitioned through `autoCloseIfInactive`,
 *     which uses `updateMany` with a compare-and-swap on the same
 *     preconditions. Two instances racing will simply have one observe
 *     count=0 and skip — the closing message is only sent when the CAS
 *     succeeds, so we never double-message the customer.
 *
 * The job NEVER throws to the scheduler; per-row failures are logged and
 * skipped so one poison row cannot stop the queue.
 */
@Injectable()
export class InactivityCloseJob {
  private readonly logger = new Logger(InactivityCloseJob.name);
  private readonly cfg: NotificationsConfig;
  private inFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly metaSender: MetaSenderService,
    private readonly realtime: RealtimeService,
  ) {
    this.cfg = config.getOrThrow<NotificationsConfig>('notifications');
  }

  /**
   * Registered as a lifecycle hook from NotificationsModule so we can
   * honor the `NOTIFICATIONS_INACTIVITY_ENABLED` kill switch — useful
   * in tests where you want the scheduler class present but dormant.
   */
  register(): void {
    if (!this.cfg.inactivityJobEnabled) {
      this.logger.log(
        `InactivityCloseJob disabled via config (cron="${this.cfg.inactivityCron}"); skipping registration.`,
      );
      return;
    }
    if (this.scheduler.getCronJobs().has(JOB_NAME)) {
      return;
    }
    const job = new CronJob(this.cfg.inactivityCron, () => {
      void this.runSafely();
    });
    this.scheduler.addCronJob(JOB_NAME, job as unknown as CronJob);
    job.start();
    this.logger.log(
      `InactivityCloseJob registered cron="${this.cfg.inactivityCron}"`,
    );
  }

  async runSafely(): Promise<{ scanned: number; closed: number }> {
    if (this.inFlight) {
      this.logger.warn(
        'InactivityCloseJob skipped: previous run still in flight.',
      );
      return { scanned: 0, closed: 0 };
    }
    this.inFlight = true;
    try {
      return await this.runOnce();
    } catch (error) {
      this.logger.error(
        `InactivityCloseJob fatal error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { scanned: 0, closed: 0 };
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * One scan cycle. Iterates tenants (each company has its own inactivity
   * threshold), looks at a bounded window of candidate conversations,
   * and transitions eligible ones with a best-effort closing message.
   */
  private async runOnce(): Promise<{ scanned: number; closed: number }> {
    const companies = await this.prisma.companySettings.findMany({
      select: {
        companyId: true,
        inactivityCloseHours: true,
      },
    });
    let scanned = 0;
    let closed = 0;

    for (const settings of companies) {
      const hours = settings.inactivityCloseHours;
      if (!Number.isFinite(hours) || hours <= 0) continue;

      const threshold = new Date(Date.now() - hours * 60 * 60 * 1000);

      const candidates = await this.prisma.conversation.findMany({
        where: {
          companyId: settings.companyId,
          status: ConvoStatus.OPEN,
          controlMode: ConversationControlMode.AGENT,
          lifecycleStatus: {
            not: ConversationLifecycleStatus.AUTO_CLOSED_INACTIVE,
          },
          OR: [
            { lastCustomerMessageAt: { lte: threshold } },
            {
              lastCustomerMessageAt: null,
              createdAt: { lte: threshold },
            },
          ],
        },
        select: {
          id: true,
          companyId: true,
          channel: true,
          contact: { select: { phone: true } },
        },
        take: this.cfg.inactivityBatchLimit,
        orderBy: { updatedAt: 'asc' },
      });

      scanned += candidates.length;

      for (const candidate of candidates) {
        const didClose = await this.closeOne({
          conversationId: candidate.id,
          companyId: candidate.companyId,
          channel: candidate.channel,
          recipientPhone: candidate.contact.phone,
          threshold,
        });
        if (didClose) closed += 1;
      }
    }

    if (scanned > 0 || closed > 0) {
      this.logger.log(
        `InactivityCloseJob cycle complete: scanned=${scanned} closed=${closed}`,
      );
    }
    return { scanned, closed };
  }

  private async closeOne(args: {
    conversationId: string;
    companyId: string;
    channel: Channel;
    recipientPhone: string | null;
    threshold: Date;
  }): Promise<boolean> {
    // Step 1: attempt the CAS close first. If the row was already closed
    // (or taken over, or the customer just replied in the last 100ms),
    // we skip BOTH the closing message and any state change.
    const closed = await this.lifecycle.autoCloseIfInactive(
      args.conversationId,
      args.threshold,
    );
    if (!closed) return false;

    // Step 2: deliver the closing message AFTER the transition commits so
    // a racing customer message cannot interleave with our goodbye. Best
    // effort — if the send fails, the close still stands; we log and
    // persist the outbound message so the dashboard thread is intact.
    const closingText = buildClosingText();
    let outboundMessageId: string | null = null;

    try {
      const created = await this.prisma.message.create({
        data: {
          conversationId: args.conversationId,
          senderType: SenderType.AGENT,
          content: closingText,
          metadata: { source: 'inactivity-auto-close' },
        },
        select: { id: true },
      });
      outboundMessageId = created.id;
    } catch (error) {
      this.logger.warn(
        `Failed to persist closing message conversation=${args.conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (args.channel === Channel.WHATSAPP && args.recipientPhone) {
      try {
        await this.metaSender.sendWhatsappText(
          args.companyId,
          args.recipientPhone,
          closingText,
        );
      } catch (error) {
        this.logger.warn(
          `Closing-message WhatsApp send failed conversation=${args.conversationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (outboundMessageId) {
      const event = await this.prisma.message.findUnique({
        where: { id: outboundMessageId },
        select: messageEventSelect,
      });
      if (event) {
        this.realtime.emitMessageCreated(toMessageEventPayload(event));
      }
    }

    return true;
  }
}

/**
 * Closing-message copy is deliberately generic + non-PII. Operators can
 * override per-company in a later phase once prompt management UI ships.
 */
function buildClosingText(): string {
  return (
    "We haven't heard back from you in a while, so we're closing this chat for now. " +
    "Just send us a new message anytime and we'll be right here."
  );
}
