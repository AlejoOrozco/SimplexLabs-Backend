import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import type { AgentsConfig } from '../../../config/configuration';
import { RetryPolicyService } from '../../../common/reliability/retry-policy.service';
import { classifyLlmError } from '../../../common/reliability/retry-classifiers';

interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAiRequestBody {
  model: string;
  messages: OpenAiChatMessage[];
  temperature: number;
  max_tokens: number;
  response_format?: { type: 'json_object' };
}

interface OpenAiResponse {
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model: string;
  id: string;
}

export interface LlmCompletionOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  temperature: number;
  maxTokens: number;
  /**
   * When true, sets OpenAI `response_format: { type: 'json_object' }`.
   * Callers still validate schema via their own parsers.
   */
  expectJson: boolean;
}

export interface LlmCompletionResult {
  content: string;
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  durationMs: number;
  finishReason: string;
}

export class LlmApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'LlmApiError';
  }
}

/**
 * Thin, strongly-typed wrapper around the OpenAI chat completions endpoint.
 * Stateless per call. Every completion logs duration + token usage so the
 * pipeline orchestrator can aggregate them into AgentRun.
 */
@Injectable()
export class OpenAiCompletionService {
  private readonly logger = new Logger(OpenAiCompletionService.name);
  private readonly http: AxiosInstance;
  private readonly defaultModel: string;

  constructor(
    config: ConfigService,
    private readonly retry: RetryPolicyService,
  ) {
    const agents = config.getOrThrow<AgentsConfig>('agents');
    this.defaultModel = agents.openaiModel;

    this.http = axios.create({
      baseURL: agents.openaiBaseUrl,
      timeout: agents.openaiTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agents.openaiApiKey}`,
      },
    });
  }

  /**
   * Perform a chat completion. Callers should pick `expectJson: true` for
   * structured steps (analyzer / decider) and `false` for the responder.
   */
  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    const body: OpenAiRequestBody = {
      model: options.model ?? this.defaultModel,
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userMessage },
      ],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };
    if (options.expectJson) {
      body.response_format = { type: 'json_object' };
    }

    const startedAt = Date.now();
    try {
      const retried = await this.retry.run(
        {
          operation: `openai.complete(${body.model})`,
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 4_000,
          classify: classifyLlmError,
        },
        async () => {
          const response = await this.http.post<OpenAiResponse>(
            '/chat/completions',
            body,
          );
          const choice = response.data.choices[0];
          if (!choice) {
            throw new LlmApiError(
              'OpenAI returned no choices in completion response',
              response.status,
              'no_choices',
            );
          }
          return { response, choice };
        },
      );

      const { response, choice } = retried.value;
      const durationMs = Date.now() - startedAt;

      return {
        content: choice.message.content,
        model: response.data.model,
        tokens: {
          prompt: response.data.usage?.prompt_tokens ?? 0,
          completion: response.data.usage?.completion_tokens ?? 0,
          total: response.data.usage?.total_tokens ?? 0,
        },
        durationMs,
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (axios.isAxiosError(error)) {
        const axErr = error as AxiosError<{
          error?: { message?: string; code?: string; type?: string };
        }>;
        const status = axErr.response?.status ?? null;
        const apiError = axErr.response?.data?.error;
        const message =
          apiError?.message ?? axErr.message ?? 'OpenAI request failed';
        const code = apiError?.code ?? apiError?.type ?? null;
        this.logger.error(
          `OpenAI call failed after ${durationMs}ms status=${status ?? 'n/a'} code=${code ?? 'n/a'} model=${body.model}: ${message}`,
        );
        throw new LlmApiError(message, status, code);
      }
      if (error instanceof LlmApiError) throw error;
      if (error instanceof Error) {
        this.logger.error(
          `OpenAI call failed after ${durationMs}ms model=${body.model}: ${error.message}`,
        );
        throw new LlmApiError(error.message, null, null);
      }
      throw new LlmApiError('Unknown OpenAI error', null, null);
    }
  }
}
