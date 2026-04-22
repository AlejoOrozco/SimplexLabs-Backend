import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AgentRole, Channel, Niche } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import {
  assertTenantAccess,
  resolveCompanyId,
} from '../../../common/tenant/tenant-scope';
import { AnalyzerService } from '../steps/analyzer.service';
import { RetrieverService } from '../steps/retriever.service';
import { DeciderService } from '../steps/decider.service';
import { ResponderService } from '../steps/responder.service';
import {
  PromptResolverService,
  type ResolvedAgentConfig,
} from '../prompts/prompt-resolver.service';
import type {
  DeciderOutput,
  ExecutorOutput,
  PipelineContext,
  RetrievedKbEntry,
  RetrievedProduct,
  RetrievedStaff,
  RetrieverOutput,
} from '../pipeline/pipeline-types';
import { SandboxRunDto } from './dto/sandbox-run.dto';
import {
  SandboxRunResponseDto,
  SandboxStepDto,
} from './dto/sandbox-run-response.dto';

interface StepAccumulator {
  step: SandboxStepDto['step'];
  ok: boolean;
  durationMs: number;
  tokens: number;
  output: unknown | null;
  error: string | null;
}

/**
 * Safe pipeline simulator. Reuses the exact same Analyzer / Retriever /
 * Decider / Responder implementations the production pipeline uses, so
 * dry-run results are a faithful preview of real behavior. The executor
 * is replaced with a pure classifier — it NEVER creates Appointments,
 * Orders, Payments, notifications, or lifecycle transitions, and no
 * outbound WhatsApp/Instagram messages are ever sent.
 *
 * Failures at any step are captured onto the step log and the run
 * continues from the point it's safe to — when a step fails catastrophically
 * we short-circuit with `finalResponse = null` and a clear error payload.
 */
@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly promptResolver: PromptResolverService,
    private readonly analyzer: AnalyzerService,
    private readonly retriever: RetrieverService,
    private readonly decider: DeciderService,
    private readonly responder: ResponderService,
  ) {}

  async run(
    dto: SandboxRunDto,
    requester: AuthenticatedUser,
  ): Promise<SandboxRunResponseDto> {
    const companyId = resolveCompanyId(requester, dto.companyId);
    assertTenantAccess(companyId, requester);

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, niche: true },
    });
    if (!company) {
      throw new BadRequestException(`Company ${companyId} not found`);
    }

    const channel = dto.channel ?? Channel.WHATSAPP;
    const resolved = await this.promptResolver.resolveForCompany(
      companyId,
      channel,
    );

    if (!resolved.channels.includes(channel)) {
      // We allow this but surface it as a warning — clients frequently
      // test against a channel before enabling it.
      this.logger.debug(
        `Sandbox run: channel=${channel} not in active config channels for company=${companyId}`,
      );
    }

    // Ephemeral pipeline context — these ids never touch the DB.
    const context: PipelineContext = {
      companyId,
      conversationId: `sandbox-convo-${randomUUID()}`,
      messageId: `sandbox-msg-${randomUUID()}`,
      channel,
      inbound: {
        content: dto.simulatedMessage,
        metaMessageId: `sandbox-${randomUUID()}`,
        from: dto.simulatedFrom ?? 'sandbox-caller',
      },
    };

    const started = Date.now();
    const steps: StepAccumulator[] = [];
    const warnings: string[] = [];
    let finalResponse: string | null = null;

    // ------------------------------------------------------------- Analyzer
    let analysis: Awaited<ReturnType<AnalyzerService['run']>>['output'] | null =
      null;
    const analyzerStart = Date.now();
    try {
      const result = await this.analyzer.run({
        prompt: resolved.prompts.ANALYZER,
        context,
      });
      analysis = result.output;

      if (dto.forceLanguage) {
        analysis = { ...analysis, language: dto.forceLanguage };
        warnings.push(
          `analyzer language overridden by request: forceLanguage=${dto.forceLanguage}`,
        );
      }
      steps.push({
        step: 'analyzer',
        ok: true,
        durationMs: result.completion.durationMs,
        tokens: result.completion.tokens.total,
        output: analysis,
        error: null,
      });
    } catch (error) {
      steps.push({
        step: 'analyzer',
        ok: false,
        durationMs: Date.now() - analyzerStart,
        tokens: 0,
        output: null,
        error: describeError(error),
      });
      return this.finalize(
        started,
        steps,
        null,
        [...warnings, 'pipeline aborted after analyzer failure'],
        resolved,
      );
    }

    // ------------------------------------------------------------- Retriever
    let retrieval: RetrieverOutput | null = null;
    const retrieverStart = Date.now();
    try {
      const result = await this.retriever.run({ context, analysis });
      retrieval = result.output;
      steps.push({
        step: 'retriever',
        ok: true,
        durationMs: Date.now() - retrieverStart,
        tokens: 0,
        output: retrieval,
        error: null,
      });
    } catch (error) {
      steps.push({
        step: 'retriever',
        ok: false,
        durationMs: Date.now() - retrieverStart,
        tokens: 0,
        output: null,
        error: describeError(error),
      });
      return this.finalize(
        started,
        steps,
        null,
        [...warnings, 'pipeline aborted after retriever failure'],
        resolved,
      );
    }

    // -------------------------------------------------------------- Decider
    let decision: DeciderOutput | null = null;
    const deciderStart = Date.now();
    try {
      const result = await this.decider.run({
        prompt: resolved.prompts.DECIDER,
        context,
        analysis,
        retrieval,
      });
      decision = result.output;
      steps.push({
        step: 'decider',
        ok: true,
        durationMs: result.completion.durationMs,
        tokens: result.completion.tokens.total,
        output: decision,
        error: null,
      });
    } catch (error) {
      steps.push({
        step: 'decider',
        ok: false,
        durationMs: Date.now() - deciderStart,
        tokens: 0,
        output: null,
        error: describeError(error),
      });
      return this.finalize(
        started,
        steps,
        null,
        [...warnings, 'pipeline aborted after decider failure'],
        resolved,
      );
    }

    // ------------------------------------------------------------- Executor (simulated)
    const execStart = Date.now();
    const executorOutput = this.simulateExecutor(decision, retrieval, warnings);
    steps.push({
      step: 'executor',
      ok: true,
      durationMs: Date.now() - execStart,
      tokens: 0,
      output: executorOutput,
      error: null,
    });

    // ------------------------------------------------------------- Responder
    const responderStart = Date.now();
    try {
      const result = await this.responder.run({
        prompt: resolved.prompts.RESPONDER,
        context,
        analysis,
        execution: executorOutput,
        business: {
          name: company.name,
          niche: toNicheString(company.niche),
          escalationMessage: resolved.escalationMessage,
          fallbackMessage: resolved.fallbackMessage,
        },
      });
      finalResponse = result.output.text.length > 0 ? result.output.text : null;
      steps.push({
        step: 'responder',
        ok: true,
        durationMs: result.completion.durationMs,
        tokens: result.completion.tokens.total,
        output: {
          text: result.output.text,
          language: result.output.language,
          fallbackUsed: result.output.fallbackUsed,
        },
        error: null,
      });
      if (result.output.fallbackUsed) {
        warnings.push(
          `responder returned fallback text (action=${executorOutput.action})`,
        );
      }
    } catch (error) {
      steps.push({
        step: 'responder',
        ok: false,
        durationMs: Date.now() - responderStart,
        tokens: 0,
        output: null,
        error: describeError(error),
      });
      return this.finalize(
        started,
        steps,
        null,
        [...warnings, 'pipeline aborted after responder failure'],
        resolved,
      );
    }

    return this.finalize(started, steps, finalResponse, warnings, resolved);
  }

  /**
   * Pure, side-effect-free stand-in for `ExecutorService`. Shapes an
   * `ExecutorOutput` using the retriever context so the Responder has
   * something realistic to quote back — but no DB rows are ever written.
   */
  private simulateExecutor(
    decision: DeciderOutput,
    retrieval: RetrieverOutput,
    warnings: string[],
  ): ExecutorOutput {
    const kbById = new Map(retrieval.knowledgeBase.map((k) => [k.id, k]));
    const productById = new Map(retrieval.products.map((p) => [p.id, p]));
    const staffById = new Map(retrieval.staff.map((s) => [s.id, s]));

    const resolvedKb: RetrievedKbEntry[] = decision.payload.kbIds
      .map((id) => kbById.get(id))
      .filter((k): k is RetrievedKbEntry => k !== undefined);
    const resolvedProducts: RetrievedProduct[] = decision.payload.productIds
      .map((id) => productById.get(id))
      .filter((p): p is RetrievedProduct => p !== undefined);
    const resolvedStaff: RetrievedStaff[] = decision.payload.staffIds
      .map((id) => staffById.get(id))
      .filter((s): s is RetrievedStaff => s !== undefined);

    switch (decision.action) {
      case 'REPLY':
      case 'REPLY_WITH_KB':
      case 'SUGGEST_PRODUCT':
      case 'NONE':
        return {
          action: decision.action,
          executed: true,
          deferred: false,
          deferredReason: null,
          result: { resolvedKb, resolvedProducts, resolvedStaff },
        };

      case 'SUGGEST_APPOINTMENT':
        warnings.push(
          'SUGGEST_APPOINTMENT simulated: no Appointment row created.',
        );
        return {
          action: decision.action,
          executed: false,
          deferred: true,
          deferredReason: 'dry-run: appointment booking simulated, not created',
          result: {
            resolvedKb,
            resolvedProducts,
            resolvedStaff,
            appointment: {
              created: false,
              appointmentId: null,
              scheduledAt: decision.payload.appointment?.requestedAtIso ?? null,
              durationMinutes:
                decision.payload.appointment?.durationMinutes ?? null,
              staffId: null,
              staffName:
                decision.payload.appointment?.staffName ?? null,
              alternatives: [],
              reason: 'Sandbox: booking not executed.',
            },
          },
        };

      case 'PLACE_ORDER':
        warnings.push('PLACE_ORDER simulated: no Order row created.');
        return {
          action: decision.action,
          executed: false,
          deferred: true,
          deferredReason: 'dry-run: order placement simulated, not created',
          result: {
            resolvedKb,
            resolvedProducts,
            resolvedStaff,
            order: {
              created: false,
              orderId: null,
              productId: decision.payload.order?.productId ?? null,
              productName: resolvedProducts[0]?.name ?? null,
              amount:
                decision.payload.order?.amount !== undefined
                  ? String(decision.payload.order.amount)
                  : resolvedProducts[0]?.price ?? null,
              reason: 'Sandbox: order not executed.',
            },
          },
        };

      case 'REQUEST_PAYMENT':
        warnings.push(
          'REQUEST_PAYMENT simulated: no Payment / Stripe session created.',
        );
        return {
          action: decision.action,
          executed: false,
          deferred: true,
          deferredReason: 'dry-run: payment initiation simulated, not created',
          result: {
            resolvedKb,
            resolvedProducts,
            resolvedStaff,
            payment: {
              initiated: false,
              paymentId: null,
              method: decision.payload.payment?.method ?? null,
              checkoutUrl: null,
              wireInstructions: null,
              orderId: decision.payload.payment?.orderId ?? null,
              reason: 'Sandbox: payment not executed.',
            },
          },
        };

      case 'ESCALATE':
        warnings.push(
          'ESCALATE simulated: no lifecycle transition or notification emitted.',
        );
        return {
          action: decision.action,
          executed: false,
          deferred: true,
          deferredReason: 'dry-run: escalation simulated, no notification sent',
          result: { resolvedKb, resolvedProducts, resolvedStaff },
        };

      default:
        warnings.push(`Unknown decider action '${decision.action}'`);
        return {
          action: decision.action,
          executed: false,
          deferred: true,
          deferredReason: `Unknown action: ${decision.action}`,
          result: { resolvedKb, resolvedProducts, resolvedStaff },
        };
    }
  }

  private finalize(
    started: number,
    steps: StepAccumulator[],
    finalResponse: string | null,
    warnings: string[],
    resolved: ResolvedAgentConfig,
  ): SandboxRunResponseDto {
    const totalTokens = steps.reduce((s, st) => s + st.tokens, 0);
    const totalDurationMs = Date.now() - started;

    const promptSources: Record<string, 'database' | 'default'> = {};
    for (const role of Object.values(AgentRole)) {
      promptSources[role] = resolved.prompts[role].source;
    }

    return {
      mode: 'sandbox',
      simulated: true,
      steps,
      finalResponse,
      warnings,
      totalTokens,
      totalDurationMs,
      resolvedConfig: {
        companyId: resolved.companyId,
        agentConfigId: resolved.agentConfigId,
        language: resolved.language,
        name: resolved.name,
        promptSources,
      },
    };
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function toNicheString(value: Niche | string): string {
  return typeof value === 'string' ? value : String(value);
}
