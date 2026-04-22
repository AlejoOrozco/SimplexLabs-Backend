import { Injectable } from '@nestjs/common';
import {
  GroqCompletionResult,
  GroqService,
} from '../providers/groq.service';
import type { ResolvedPrompt } from '../prompts/prompt-resolver.service';
import type { AnalyzedLanguage, AnalyzedUrgency, AnalyzerOutput, PipelineContext } from '../pipeline/pipeline-types';
import {
  asString,
  asStringArray,
  isRecord,
  parseJsonCompletion,
} from '../validation/parse-json';

export interface AnalyzerStepInput {
  prompt: ResolvedPrompt;
  context: PipelineContext;
}

export interface AnalyzerStepResult {
  input: {
    systemPromptSource: ResolvedPrompt['source'];
    model: string;
    temperature: number;
    userMessage: string;
  };
  output: AnalyzerOutput;
  raw: string;
  completion: GroqCompletionResult;
}

const VALID_LANGUAGES = new Set<AnalyzedLanguage>(['es', 'en']);
const VALID_URGENCY = new Set<AnalyzedUrgency>(['low', 'medium', 'high']);

@Injectable()
export class AnalyzerService {
  constructor(private readonly groq: GroqService) {}

  async run(input: AnalyzerStepInput): Promise<AnalyzerStepResult> {
    const userMessage = this.buildUserMessage(input.context);
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
        temperature: input.prompt.temperature,
        userMessage,
      },
      output,
      raw: completion.content,
      completion,
    };
  }

  private buildUserMessage(context: PipelineContext): string {
    return [
      `Channel: ${context.channel}`,
      `Customer: ${context.inbound.from}`,
      `Message:`,
      context.inbound.content,
    ].join('\n');
  }

  private validate(raw: string): AnalyzerOutput {
    const parsed = parseJsonCompletion(raw);
    if (!isRecord(parsed)) {
      throw new Error('Analyzer output was not a JSON object');
    }

    const intent = asString(parsed.intent, 'other');
    const rawLang = asString(parsed.language, 'es').toLowerCase();
    const language: AnalyzedLanguage = VALID_LANGUAGES.has(
      rawLang as AnalyzedLanguage,
    )
      ? (rawLang as AnalyzedLanguage)
      : 'es';

    const rawUrg = asString(parsed.urgency, 'low').toLowerCase();
    const urgency: AnalyzedUrgency = VALID_URGENCY.has(
      rawUrg as AnalyzedUrgency,
    )
      ? (rawUrg as AnalyzedUrgency)
      : 'low';

    const summary = asString(parsed.summary, '').slice(0, 280);

    const entitiesRaw = isRecord(parsed.entities) ? parsed.entities : {};
    return {
      intent,
      language,
      urgency,
      summary,
      entities: {
        names: asStringArray(entitiesRaw.names),
        dates: asStringArray(entitiesRaw.dates),
        products: asStringArray(entitiesRaw.products),
        amounts: asStringArray(entitiesRaw.amounts),
        staff: asStringArray(entitiesRaw.staff),
      },
    };
  }
}
