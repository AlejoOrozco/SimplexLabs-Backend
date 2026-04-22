import { Injectable, Logger } from '@nestjs/common';
import {
  Channel,
  ConversationControlMode,
  NotificationType,
  Prisma,
  SenderType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MetaSenderService } from '../../webhooks/meta-sender.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  conversationEventSelect,
  messageEventSelect,
  toConversationEventPayload,
  toMessageEventPayload,
  type MessageEventRow,
} from '../../realtime/realtime-payload.mapper';
import { AnalyzerService } from '../steps/analyzer.service';
import { RetrieverService } from '../steps/retriever.service';
import { DeciderService } from '../steps/decider.service';
import { ExecutorService } from '../steps/executor.service';
import { ResponderService } from '../steps/responder.service';
import { PromptResolverService } from '../prompts/prompt-resolver.service';
import type { PipelineContext, PipelineResult } from './pipeline-types';

interface StepLog {
  tokens: number;
  durationMs: number;
}

/**
 * Orchestrates the 5-step agent pipeline for a single inbound message.
 *
 * Responsibilities:
 *   1. Resolve prompts + agent config for the company/channel.
 *   2. Run Analyzer → Retriever → Decider → Executor → Responder sequentially.
 *   3. Persist a single `AgentRun` row with per-step input/output, aggregate
 *      tokens, duration, success flag and error message.
 *   4. On success with non-empty responder text: persist outbound `Message`,
 *      link it to the AgentRun, send via Meta, update conversation timestamps.
 *   5. On any failure: persist a failed `AgentRun`, send the company's
 *      configured fallback message (best-effort, non-blocking).
 *
 * The orchestrator never throws to its caller (the webhook ingestion flow).
 * Meta retries on non-2xx — we've already ACKed — and failed runs are
 * fully logged to the DB for debugging.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promptResolver: PromptResolverService,
    private readonly analyzer: AnalyzerService,
    private readonly retriever: RetrieverService,
    private readonly decider: DeciderService,
    private readonly executor: ExecutorService,
    private readonly responder: ResponderService,
    private readonly metaSender: MetaSenderService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(context: PipelineContext): Promise<PipelineResult> {
    const startedAt = Date.now();
    const stepLogs: StepLog[] = [];

    // -------------------------------------------------------------------
    // Pre-run gate: if the conversation is in HUMAN mode, skip entirely.
    // We don't persist an AgentRun for skipped runs because nothing was
    // executed — webhook ingest already logged the inbound message.
    // -------------------------------------------------------------------
    const preState = await this.prisma.conversation.findUnique({
      where: { id: context.conversationId },
      select: { controlMode: true },
    });
    if (preState?.controlMode === ConversationControlMode.HUMAN) {
      this.logger.log(
        `Pipeline SKIPPED (HUMAN mode) message=${context.messageId} conversation=${context.conversationId}`,
      );
      return {
        success: true,
        error: null,
        totalTokens: 0,
        durationMs: Date.now() - startedAt,
        responderText: null,
        outboundMessageId: null,
        skipped: true,
        skipReason: 'conversation_in_human_mode',
      };
    }

    const runPayload: Prisma.AgentRunUncheckedCreateInput = {
      conversationId: context.conversationId,
      messageId: context.messageId,
      analyzerInput: Prisma.JsonNull,
      analyzerOutput: Prisma.JsonNull,
      retrieverInput: Prisma.JsonNull,
      retrieverOutput: Prisma.JsonNull,
      deciderInput: Prisma.JsonNull,
      deciderOutput: Prisma.JsonNull,
      executorInput: Prisma.JsonNull,
      executorOutput: Prisma.JsonNull,
      responderInput: Prisma.JsonNull,
      responderOutput: Prisma.JsonNull,
      totalTokens: 0,
      durationMs: 0,
      success: false,
      error: null,
    };

    let responderText: string | null = null;

    try {
      const resolved = await this.promptResolver.resolveForCompany(
        context.companyId,
        context.channel,
      );

      // Step 1 — Analyzer
      const analyzerResult = await this.analyzer.run({
        prompt: resolved.prompts.ANALYZER,
        context,
      });
      stepLogs.push({
        tokens: analyzerResult.completion.tokens.total,
        durationMs: analyzerResult.completion.durationMs,
      });
      runPayload.analyzerInput = toJson(analyzerResult.input);
      runPayload.analyzerOutput = toJson(analyzerResult.output);

      // Step 2 — Retriever (no LLM)
      const retrieverResult = await this.retriever.run({
        context,
        analysis: analyzerResult.output,
      });
      runPayload.retrieverInput = toJson(retrieverResult.input);
      runPayload.retrieverOutput = toJson(retrieverResult.output);

      // Step 3 — Decider
      const deciderResult = await this.decider.run({
        prompt: resolved.prompts.DECIDER,
        context,
        analysis: analyzerResult.output,
        retrieval: retrieverResult.output,
      });
      stepLogs.push({
        tokens: deciderResult.completion.tokens.total,
        durationMs: deciderResult.completion.durationMs,
      });
      runPayload.deciderInput = toJson(deciderResult.input);
      runPayload.deciderOutput = toJson(deciderResult.output);

      // Step 4 — Executor: may touch the DB (creates PENDING appointments
      // when decider proposes SUGGEST_APPOINTMENT and a slot is available).
      const executorResult = await this.executor.run({
        context,
        decision: deciderResult.output,
        retrieval: retrieverResult.output,
      });
      runPayload.executorInput = toJson(executorResult.input);
      runPayload.executorOutput = toJson(executorResult.output);

      // Step 5 — Responder
      const company = await this.prisma.company.findUniqueOrThrow({
        where: { id: context.companyId },
        select: { name: true, niche: true },
      });
      const responderResult = await this.responder.run({
        prompt: resolved.prompts.RESPONDER,
        context,
        analysis: analyzerResult.output,
        execution: executorResult.output,
        business: {
          name: company.name,
          niche: company.niche,
          escalationMessage: resolved.escalationMessage,
          fallbackMessage: resolved.fallbackMessage,
        },
      });
      stepLogs.push({
        tokens: responderResult.completion.tokens.total,
        durationMs: responderResult.completion.durationMs,
      });
      runPayload.responderInput = toJson(responderResult.input);
      runPayload.responderOutput = toJson(responderResult.output);

      responderText =
        responderResult.output.text.length > 0
          ? responderResult.output.text
          : null;

      runPayload.success = true;
      runPayload.error = null;
      runPayload.totalTokens = sumTokens(stepLogs);
      runPayload.durationMs = Date.now() - startedAt;

      const persistResult = await this.persistRunAndOutbound(
        context,
        runPayload,
        responderText,
      );

      this.logger.log(
        `Pipeline ${persistResult.skipped ? 'SKIPPED (race)' : 'OK'} run=${persistResult.agentRunId} message=${context.messageId} action=${executorResult.output.action} tokens=${runPayload.totalTokens} duration=${runPayload.durationMs}ms`,
      );

      if (persistResult.messageEvent) {
        this.realtime.emitMessageCreated(
          toMessageEventPayload(persistResult.messageEvent),
        );
      }
      await this.emitConversationUpdated(context.conversationId);

      return {
        success: true,
        error: null,
        totalTokens: runPayload.totalTokens,
        durationMs: runPayload.durationMs,
        responderText: persistResult.skipped ? null : responderText,
        outboundMessageId: persistResult.outboundMessageId,
        skipped: persistResult.skipped ? true : undefined,
        skipReason: persistResult.skipped ? 'takeover_during_run' : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runPayload.success = false;
      runPayload.error = message.slice(0, 2000);
      runPayload.totalTokens = sumTokens(stepLogs);
      runPayload.durationMs = Date.now() - startedAt;

      this.logger.error(
        `Pipeline FAILED message=${context.messageId} company=${context.companyId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      const fallback = await this.persistFailedRunAndFallback(
        context,
        runPayload,
      );

      return {
        success: false,
        error: message,
        totalTokens: runPayload.totalTokens,
        durationMs: runPayload.durationMs,
        responderText: fallback.text,
        outboundMessageId: fallback.outboundMessageId,
      };
    }
  }

  private async persistRunAndOutbound(
    context: PipelineContext,
    runPayload: Prisma.AgentRunUncheckedCreateInput,
    responderText: string | null,
  ): Promise<{
    agentRunId: string;
    outboundMessageId: string | null;
    skipped: boolean;
    messageEvent: MessageEventRow | null;
  }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const run = await tx.agentRun.create({
        data: runPayload,
        select: { id: true },
      });

      if (!responderText) {
        return {
          agentRunId: run.id,
          outboundMessageId: null as string | null,
          skipped: false,
        };
      }

      // --------------------------------------------------------------
      // RACE-SAFE GUARD (the "human wins" pivot):
      //   Before creating the outbound Message + updating the convo,
      //   we atomically assert the convo is STILL in AGENT mode. If
      //   a takeover committed in the meantime, `updateMany` returns
      //   count=0 and we ROLL BACK by throwing — the whole tx aborts,
      //   and we do NOT send the outbound.
      //
      // Because takeover uses the same compare-and-swap on controlMode,
      // the two transactions serialize correctly under Postgres's
      // default REPEATABLE READ semantics: whichever commits first
      // causes the other's guarded update to see 0 rows.
      // --------------------------------------------------------------
      const now = new Date();
      const gate = await tx.conversation.updateMany({
        where: {
          id: context.conversationId,
          controlMode: ConversationControlMode.AGENT,
        },
        data: { lastAgentMessageAt: now, updatedAt: now },
      });
      if (gate.count === 0) {
        throw new TakeoverRaceError();
      }

      const outbound = await tx.message.create({
        data: {
          conversationId: context.conversationId,
          agentRunId: run.id,
          senderType: SenderType.AGENT,
          content: responderText,
          sentAt: now,
          metadata: toJson({ source: 'pipeline' }),
        },
        select: { id: true },
      });

      return {
        agentRunId: run.id,
        outboundMessageId: outbound.id as string | null,
        skipped: false,
      };
    }).catch(async (error) => {
      if (error instanceof TakeoverRaceError) {
        // Persist a "skipped" run so we still have an audit trail.
        const run = await this.prisma.agentRun.create({
          data: {
            ...runPayload,
            error: 'skipped: takeover committed during run',
          },
          select: { id: true },
        });
        return {
          agentRunId: run.id,
          outboundMessageId: null as string | null,
          skipped: true,
        };
      }
      throw error;
    });

    if (result.skipped) {
      this.logger.log(
        `Pipeline outbound ABORTED (takeover during run) message=${context.messageId} conversation=${context.conversationId}`,
      );
      return { ...result, messageEvent: null };
    }

    let messageEvent: MessageEventRow | null = null;
    if (result.outboundMessageId && responderText) {
      messageEvent = await this.loadMessageEvent(result.outboundMessageId);
      await this.sendOutbound(context, responderText);
    }

    return { ...result, messageEvent };
  }

  private async loadMessageEvent(messageId: string) {
    return this.prisma.message.findUniqueOrThrow({
      where: { id: messageId },
      select: messageEventSelect,
    });
  }

  private async persistFailedRunAndFallback(
    context: PipelineContext,
    runPayload: Prisma.AgentRunUncheckedCreateInput,
  ): Promise<{ text: string | null; outboundMessageId: string | null }> {
    let fallbackText: string | null = null;
    try {
      const resolved = await this.promptResolver.resolveForCompany(
        context.companyId,
        context.channel,
      );
      fallbackText = resolved.fallbackMessage;
    } catch (error) {
      this.logger.warn(
        `Could not load fallback message for company=${context.companyId}: ${describeError(error)}`,
      );
    }

    try {
      const txResult = await this.prisma
        .$transaction(async (tx) => {
          const run = await tx.agentRun.create({
            data: runPayload,
            select: { id: true },
          });

          if (!fallbackText) {
            return {
              agentRunId: run.id,
              outboundMessageId: null as string | null,
              skipped: false,
            };
          }

          const now = new Date();
          const gate = await tx.conversation.updateMany({
            where: {
              id: context.conversationId,
              controlMode: ConversationControlMode.AGENT,
            },
            data: { lastAgentMessageAt: now, updatedAt: now },
          });
          if (gate.count === 0) {
            throw new TakeoverRaceError();
          }

          const outbound = await tx.message.create({
            data: {
              conversationId: context.conversationId,
              agentRunId: run.id,
              senderType: SenderType.AGENT,
              content: fallbackText,
              sentAt: now,
              metadata: toJson({ source: 'pipeline-fallback' }),
            },
            select: { id: true },
          });

          return {
            agentRunId: run.id,
            outboundMessageId: outbound.id as string | null,
            skipped: false,
          };
        })
        .catch(async (error) => {
          if (error instanceof TakeoverRaceError) {
            const run = await this.prisma.agentRun.create({
              data: {
                ...runPayload,
                error:
                  (runPayload.error ?? 'failed') +
                  ' + fallback skipped: takeover committed',
              },
              select: { id: true },
            });
            return {
              agentRunId: run.id,
              outboundMessageId: null as string | null,
              skipped: true,
            };
          }
          throw error;
        });

      if (txResult.skipped) {
        return { text: null, outboundMessageId: null };
      }

      if (txResult.outboundMessageId && fallbackText) {
        const messageEvent = await this.loadMessageEvent(
          txResult.outboundMessageId,
        );
        await this.sendOutbound(context, fallbackText);
        this.realtime.emitMessageCreated(toMessageEventPayload(messageEvent));
        await this.emitConversationUpdated(context.conversationId);
      }

      // Surface the pipeline failure to operators. The notification flow
      // is fully isolated in a try/catch — we would never re-fail a
      // fallback path because a downstream channel adapter throws.
      try {
        const failureText = (runPayload.error ?? 'unknown').toString();
        await this.notifications.create({
          companyId: context.companyId,
          type: NotificationType.PIPELINE_FAILED,
          title: 'Pipeline failure',
          body: `The agent pipeline failed while handling a message. Reason: ${failureText.slice(0, 280)}`,
          conversationId: context.conversationId,
          payload: {
            messageId: context.messageId,
            fallbackSent: Boolean(txResult.outboundMessageId),
          },
        });
      } catch (notifyError) {
        this.logger.warn(
          `Pipeline-failure notification create failed: ${describeError(notifyError)}`,
        );
      }

      return { text: fallbackText, outboundMessageId: txResult.outboundMessageId };
    } catch (persistError) {
      this.logger.error(
        `Failed to persist failed AgentRun for message=${context.messageId}: ${describeError(persistError)}`,
      );
      return { text: null, outboundMessageId: null };
    }
  }

  private async emitConversationUpdated(conversationId: string): Promise<void> {
    const fresh = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: conversationEventSelect,
    });
    if (fresh) {
      this.realtime.emitConversationUpdated(toConversationEventPayload(fresh));
    }
  }

  private async sendOutbound(
    context: PipelineContext,
    text: string,
  ): Promise<void> {
    try {
      if (context.channel !== Channel.WHATSAPP) {
        this.logger.warn(
          `Outbound send skipped: channel=${context.channel} not supported for sending in Phase 2`,
        );
        return;
      }
      await this.metaSender.sendWhatsappText(
        context.companyId,
        context.inbound.from,
        text,
      );
    } catch (error) {
      this.logger.error(
        `Outbound send failed (message persisted) company=${context.companyId} to=${context.inbound.from}: ${describeError(error)}`,
      );
    }
  }
}

/**
 * Sentinel used to roll back a pipeline-persist transaction when a
 * concurrent takeover has flipped `controlMode` to HUMAN. Thrown
 * intentionally; caller catches it and persists a skipped AgentRun
 * outside the aborted transaction.
 */
class TakeoverRaceError extends Error {
  constructor() {
    super('takeover_race');
    this.name = 'TakeoverRaceError';
  }
}

function sumTokens(logs: StepLog[]): number {
  return logs.reduce((sum, log) => sum + log.tokens, 0);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return 'unknown error';
}

/**
 * Serialize → parse to guarantee the result is a structurally-valid
 * Prisma.InputJsonValue, preventing accidental leakage of class
 * instances, functions, or `undefined` into Json columns.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
