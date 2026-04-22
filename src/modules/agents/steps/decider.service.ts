import { Injectable } from '@nestjs/common';
import {
  GroqCompletionResult,
  GroqService,
} from '../providers/groq.service';
import type { ResolvedPrompt } from '../prompts/prompt-resolver.service';
import {
  DECIDER_ACTIONS,
  type AnalyzerOutput,
  type DeciderAction,
  type DeciderOutput,
  type PipelineContext,
  type RetrieverOutput,
} from '../pipeline/pipeline-types';
import {
  asString,
  asStringArray,
  isRecord,
  parseJsonCompletion,
} from '../validation/parse-json';

export interface DeciderStepInput {
  prompt: ResolvedPrompt;
  context: PipelineContext;
  analysis: AnalyzerOutput;
  retrieval: RetrieverOutput;
}

export interface DeciderStepResult {
  input: {
    systemPromptSource: ResolvedPrompt['source'];
    model: string;
    payload: {
      message: string;
      analysis: AnalyzerOutput;
      kb: { id: string; title: string }[];
      products: { id: string; name: string }[];
      staff: { id: string; firstName: string; lastName: string }[];
    };
  };
  output: DeciderOutput;
  raw: string;
  completion: GroqCompletionResult;
}

const VALID_ACTIONS = new Set<DeciderAction>(DECIDER_ACTIONS);

@Injectable()
export class DeciderService {
  constructor(private readonly groq: GroqService) {}

  async run(input: DeciderStepInput): Promise<DeciderStepResult> {
    const payload = {
      message: input.context.inbound.content,
      analysis: input.analysis,
      kb: input.retrieval.knowledgeBase.map((k) => ({
        id: k.id,
        title: k.title,
      })),
      products: input.retrieval.products.map((p) => ({
        id: p.id,
        name: p.name,
      })),
      staff: input.retrieval.staff.map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
      })),
    };

    const userMessage = JSON.stringify(payload);
    const completion = await this.groq.complete({
      systemPrompt: input.prompt.systemPrompt,
      userMessage,
      model: input.prompt.model,
      temperature: input.prompt.temperature,
      maxTokens: input.prompt.maxTokens,
      expectJson: true,
    });

    const output = this.validate(completion.content);

    return {
      input: {
        systemPromptSource: input.prompt.source,
        model: input.prompt.model,
        payload,
      },
      output,
      raw: completion.content,
      completion,
    };
  }

  private validate(raw: string): DeciderOutput {
    const parsed = parseJsonCompletion(raw);
    if (!isRecord(parsed)) {
      throw new Error('Decider output was not a JSON object');
    }

    const rawAction = asString(parsed.action, 'NONE').toUpperCase();
    const action: DeciderAction = VALID_ACTIONS.has(rawAction as DeciderAction)
      ? (rawAction as DeciderAction)
      : 'NONE';

    const payloadRaw = isRecord(parsed.payload) ? parsed.payload : {};
    const appointmentRaw = isRecord(payloadRaw.appointment)
      ? payloadRaw.appointment
      : undefined;

    const appointment = appointmentRaw
      ? {
          requestedAtIso: coerceIso(appointmentRaw.requestedAtIso),
          staffName: asString(appointmentRaw.staffName).trim() || undefined,
          durationMinutes: coerceDuration(appointmentRaw.durationMinutes),
          title: asString(appointmentRaw.title).slice(0, 120) || undefined,
        }
      : undefined;

    const orderRaw = isRecord(payloadRaw.order) ? payloadRaw.order : undefined;
    const order = orderRaw
      ? {
          productId: asString(orderRaw.productId).trim() || undefined,
          amount: coerceMoney(orderRaw.amount),
          notes: asString(orderRaw.notes).slice(0, 500) || undefined,
        }
      : undefined;

    const paymentRaw = isRecord(payloadRaw.payment)
      ? payloadRaw.payment
      : undefined;
    const payment = paymentRaw
      ? {
          method: coercePaymentMethod(paymentRaw.method),
          orderId: asString(paymentRaw.orderId).trim() || undefined,
        }
      : undefined;

    return {
      action,
      reason: asString(parsed.reason, '').slice(0, 280),
      payload: {
        kbIds: asStringArray(payloadRaw.kbIds),
        productIds: asStringArray(payloadRaw.productIds),
        staffIds: asStringArray(payloadRaw.staffIds),
        ...(appointment ? { appointment } : {}),
        ...(order ? { order } : {}),
        ...(payment ? { payment } : {}),
      },
    };
  }
}

function coerceIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? undefined : new Date(ts).toISOString();
}

function coerceDuration(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const int = Math.round(value);
  if (int < 5 || int > 480) return undefined;
  return int;
}

function coerceMoney(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value <= 0 || value > 1_000_000) return undefined;
  return Math.round(value * 100) / 100;
}

function coercePaymentMethod(
  value: unknown,
): 'STRIPE' | 'WIRE_TRANSFER' | undefined {
  if (value === 'STRIPE' || value === 'WIRE_TRANSFER') return value;
  return undefined;
}
