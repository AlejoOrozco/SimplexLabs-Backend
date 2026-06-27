import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Channel,
  ContactSource,
  ConversationControlMode,
  ConversationLifecycleStatus,
  ConvoStatus,
  Prisma,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PipelineService } from '../agents/pipeline/pipeline.service';
import { RealtimeService } from '../realtime/realtime.service';
import { WebhookDedupeService } from '../../common/reliability/webhook-dedupe.service';
import { FailedTaskService } from '../../common/reliability/failed-task.service';
import { WhatsAppSenderService } from './whatsapp-sender.service';
import type { AgentsConfig } from '../../config/configuration';
import {
  logContext,
  runWithExtendedContext,
} from '../../common/observability/correlation-context';
import {
  conversationEventSelect,
  messageEventSelect,
  toConversationEventPayload,
  toMessageEventPayload,
} from '../realtime/realtime-payload.mapper';

export interface IngestWhatsAppInboundParams {
  provider: 'twilio';
  providerEventId: string;
  companyId: string;
  from: string;
  content: string;
  metadata: Prisma.InputJsonValue;
  sentAt: Date;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => PipelineService))
    private readonly pipeline: PipelineService,
    private readonly realtime: RealtimeService,
    private readonly dedupe: WebhookDedupeService,
    private readonly failedTasks: FailedTaskService,
    private readonly whatsappSender: WhatsAppSenderService,
  ) {}

  /**
   * Shared choke-point for Twilio WhatsApp inbound events.
   * Handles dedupe, contact/conversation persistence, realtime emits,
   * and agent-pipeline dispatch.
   */
  async ingestWhatsAppInbound(params: IngestWhatsAppInboundParams): Promise<void> {
    const providerKey = `${params.provider}:whatsapp`;
    const claim = await this.dedupe.claim({
      provider: providerKey,
      providerEventId: params.providerEventId,
      companyId: params.companyId,
    });
    if (!claim.claimed) {
      this.logger.log(
        `Duplicate inbound provider_event=${params.providerEventId} provider=${providerKey} — claim skipped (existing=${claim.existingId})`,
      );
      return;
    }

    try {
      const contact = await this.findOrCreateContact(
        params.companyId,
        Channel.WHATSAPP,
        params.from,
      );

      const conversation = await this.findOrCreateOpenConversation(
        params.companyId,
        contact.id,
        Channel.WHATSAPP,
      );

      const enrichedMetadata =
        conversation.created && conversation.previousConversationId
          ? toJsonValue({
              ...(params.metadata as Record<string, unknown>),
              previousConversationId: conversation.previousConversationId,
            })
          : params.metadata;

      const [createdMessage] = await this.prisma.$transaction([
        this.prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderType: SenderType.CONTACT,
            content: params.content,
            sentAt: params.sentAt,
            metadata: enrichedMetadata,
          },
          select: messageEventSelect,
        }),
        this.prisma.conversation.update({
          where: { id: conversation.id },
          data: { lastCustomerMessageAt: params.sentAt },
          select: { id: true },
        }),
      ]);

      this.logger.log(
        `Stored inbound WHATSAPP message provider_event=${params.providerEventId} conversation=${conversation.id} contact=${contact.id} company=${params.companyId}${
          conversation.previousConversationId
            ? ` (reopened from closed=${conversation.previousConversationId})`
            : ''
        }`,
      );

      if (conversation.created) {
        const fresh = await this.prisma.conversation.findUnique({
          where: { id: conversation.id },
          select: conversationEventSelect,
        });
        if (fresh) {
          this.realtime.emitConversationCreated(toConversationEventPayload(fresh));
        }
      }
      this.realtime.emitMessageCreated(toMessageEventPayload(createdMessage));

      const agents = this.config.getOrThrow<AgentsConfig>('agents');
      const isProduction = this.config.get<string>('nodeEnv') === 'production';
      if (!isProduction && !agents.runPipelineInDev) {
        await this.sendTestEchoResponse(
          params.companyId,
          params.from,
          params.content,
          conversation.id,
        );
        await this.dedupe.markProcessed(claim.id, 'test_echo');
        return;
      }

      const messageId = createdMessage.id;
      void runWithExtendedContext(
        { companyId: params.companyId, conversationId: conversation.id, messageId },
        () =>
          this.pipeline
            .run({
              companyId: params.companyId,
              conversationId: conversation.id,
              messageId,
              channel: Channel.WHATSAPP,
              inbound: {
                content: params.content,
                metaMessageId: params.providerEventId,
                from: params.from,
              },
            })
            .then(() => undefined)
            .catch(async (error) => {
              this.logger.error(
                `Unexpected pipeline error ${logContext()} provider_event=${params.providerEventId}: ${describeError(error)}`,
              );
              try {
                await this.failedTasks.record({
                  companyId: params.companyId,
                  taskType: 'pipeline.run',
                  payload: {
                    companyId: params.companyId,
                    conversationId: conversation.id,
                    messageId,
                    channel: Channel.WHATSAPP,
                    inbound: {
                      content: params.content,
                      metaMessageId: params.providerEventId,
                      from: params.from,
                    },
                  },
                  error,
                  attempts: 1,
                });
              } catch (dlqError) {
                this.logger.error(
                  `Failed to record pipeline failure to DLQ: ${describeError(dlqError)}`,
                );
              }
            }),
      );

      await this.dedupe.markProcessed(claim.id, 'ingested');
    } catch (error) {
      this.logger.error(
        `Failed to ingest inbound WHATSAPP message ${logContext()} provider_event=${params.providerEventId} from=${params.from}: ${describeError(error)}`,
      );
      await this.dedupe.markFailed(claim.id, describeError(error));
    }
  }

  private async findOrCreateContact(
    companyId: string,
    channel: Channel,
    phone: string,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.clientContact.findFirst({
      where: { companyId, phone },
      select: { id: true },
    });
    if (existing) return existing;

    const created = await this.prisma.clientContact.create({
      data: {
        companyId,
        phone,
        firstName: phone,
        lastName: '',
        source: channelToContactSource(channel),
      },
      select: { id: true },
    });

    this.logger.log(
      `Created ClientContact ${created.id} for phone=${phone} company=${companyId}`,
    );
    return created;
  }

  /**
   * Enforce "at most one open conversation per (contactId, channel)" at
   * the service layer now that the DB-level hard unique was removed.
   */
  private async findOrCreateOpenConversation(
    companyId: string,
    contactId: string,
    channel: Channel,
  ): Promise<{
    id: string;
    created: boolean;
    previousConversationId: string | null;
  }> {
    const existing = await this.prisma.conversation.findFirst({
      where: {
        companyId,
        contactId,
        channel,
        status: { not: ConvoStatus.CLOSED },
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { id: existing.id, created: false, previousConversationId: null };
    }

    const closed = await this.prisma.conversation.findFirst({
      where: {
        companyId,
        contactId,
        channel,
        status: ConvoStatus.CLOSED,
      },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });

    const created = await this.prisma.conversation.create({
      data: {
        companyId,
        contactId,
        channel,
        status: ConvoStatus.OPEN,
        lifecycleStatus: ConversationLifecycleStatus.NEW,
        controlMode: ConversationControlMode.AGENT,
      },
      select: { id: true },
    });

    this.logger.log(
      `Created Conversation ${created.id} for contact=${contactId} channel=${channel} company=${companyId}${
        closed ? ` (reopened from closed=${closed.id})` : ''
      }`,
    );
    return {
      id: created.id,
      created: true,
      previousConversationId: closed?.id ?? null,
    };
  }

  /**
   * Temporary echo for non-production when AGENT_PIPELINE_IN_DEV is false.
   */
  private async sendTestEchoResponse(
    companyId: string,
    recipientPhone: string,
    incomingMessage: string,
    conversationId: string,
  ): Promise<void> {
    try {
      const echoText = `[TEST MODE] Received: "${incomingMessage}" — SimplexLabs agent pipeline will respond here.`;

      const sentMessageId = await this.whatsappSender.sendTextMessage({
        companyId,
        recipientPhone,
        text: echoText,
      });

      const outbound = await this.prisma.message.create({
        data: {
          conversationId,
          senderType: SenderType.AGENT,
          content: echoText,
          sentAt: new Date(),
          metadata: sentMessageId
            ? toJsonValue({ twilioMessageSid: sentMessageId, source: 'test_echo' })
            : toJsonValue({ source: 'test_echo' }),
        },
        select: messageEventSelect,
      });

      this.realtime.emitMessageCreated(toMessageEventPayload(outbound));

      this.logger.log(
        `Echo response sent to ${recipientPhone} for conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send echo response: ${describeError(error)}`,
      );
    }
  }
}

function channelToContactSource(channel: Channel): ContactSource {
  switch (channel) {
    case Channel.WHATSAPP:
      return ContactSource.WHATSAPP;
    case Channel.INSTAGRAM:
      return ContactSource.INSTAGRAM;
    case Channel.MESSENGER:
      return ContactSource.MESSENGER;
  }
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return '[unserializable error]';
  }
}
