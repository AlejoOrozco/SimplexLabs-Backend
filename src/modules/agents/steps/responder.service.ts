import { Injectable } from '@nestjs/common';
import {
  GroqCompletionResult,
  GroqService,
} from '../providers/groq.service';
import type { ResolvedPrompt } from '../prompts/prompt-resolver.service';
import type {
  AnalyzedLanguage,
  AnalyzerOutput,
  ExecutorOutput,
  PipelineContext,
  ResponderOutput,
} from '../pipeline/pipeline-types';

export interface ResponderStepInput {
  prompt: ResolvedPrompt;
  context: PipelineContext;
  analysis: AnalyzerOutput;
  execution: ExecutorOutput;
  business: {
    name: string;
    niche: string;
    escalationMessage: string;
    fallbackMessage: string;
  };
}

export interface ResponderStepResult {
  input: {
    systemPromptSource: ResolvedPrompt['source'];
    model: string;
    payload: Record<string, unknown>;
  };
  output: ResponderOutput;
  raw: string;
  completion: GroqCompletionResult;
}

const MIN_REPLY_LEN = 2;

@Injectable()
export class ResponderService {
  constructor(private readonly groq: GroqService) {}

  async run(input: ResponderStepInput): Promise<ResponderStepResult> {
    const payload = {
      customerMessage: input.context.inbound.content,
      business: {
        name: input.business.name,
        niche: input.business.niche,
      },
      language: input.analysis.language,
      action: input.execution.action,
      executed: input.execution.executed,
      deferred: input.execution.deferred,
      context: {
        kb: input.execution.result.resolvedKb.map((k) => ({
          title: k.title,
          content: k.content,
          category: k.category,
        })),
        products: input.execution.result.resolvedProducts.map((p) => ({
          name: p.name,
          description: p.description,
          type: p.type,
          price: p.price,
        })),
        staff: input.execution.result.resolvedStaff.map((s) => ({
          firstName: s.firstName,
          lastName: s.lastName,
          role: s.role,
        })),
        appointment: input.execution.result.appointment
          ? {
              created: input.execution.result.appointment.created,
              scheduledAt: input.execution.result.appointment.scheduledAt,
              staffName: input.execution.result.appointment.staffName,
              alternatives: input.execution.result.appointment.alternatives,
              reason: input.execution.result.appointment.reason,
            }
          : null,
        order: input.execution.result.order
          ? {
              created: input.execution.result.order.created,
              orderId: input.execution.result.order.orderId,
              productName: input.execution.result.order.productName,
              amount: input.execution.result.order.amount,
              reason: input.execution.result.order.reason,
            }
          : null,
        payment: input.execution.result.payment
          ? {
              initiated: input.execution.result.payment.initiated,
              method: input.execution.result.payment.method,
              checkoutUrl: input.execution.result.payment.checkoutUrl,
              wireInstructions:
                input.execution.result.payment.wireInstructions,
              reason: input.execution.result.payment.reason,
            }
          : null,
      },
    };

    const userMessage = JSON.stringify(payload);
    const completion = await this.groq.complete({
      systemPrompt: input.prompt.systemPrompt,
      userMessage,
      model: input.prompt.model,
      temperature: input.prompt.temperature,
      maxTokens: input.prompt.maxTokens,
      expectJson: false,
    });

    const cleaned = completion.content.trim();
    const output = this.interpret(cleaned, input);

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

  private interpret(
    cleaned: string,
    input: ResponderStepInput,
  ): ResponderOutput {
    const language: AnalyzedLanguage = input.analysis.language;

    // NONE path: responder is instructed to return a single space → don't send.
    if (cleaned.length < MIN_REPLY_LEN && input.execution.action === 'NONE') {
      return { text: '', language, fallbackUsed: false };
    }

    if (input.execution.action === 'ESCALATE' && cleaned.length < MIN_REPLY_LEN) {
      return {
        text: input.business.escalationMessage,
        language,
        fallbackUsed: true,
      };
    }

    if (cleaned.length < MIN_REPLY_LEN) {
      return {
        text: input.business.fallbackMessage,
        language,
        fallbackUsed: true,
      };
    }

    return { text: cleaned, language, fallbackUsed: false };
  }
}
