import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance } from 'axios';
import type { AgentsConfig } from '../../../config/configuration';
import { RetryPolicyService } from '../../../common/reliability/retry-policy.service';
import { classifyLlmError } from '../../../common/reliability/retry-classifiers';

/**
 * OpenAI-compatible Groq chat completion request shape (subset).
 */
interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GroqRequestBody {
  model: string;
  messages: GroqChatMessage[];
  temperature: number;
  max_tokens: number;
  response_format?: { type: 'json_object' };
}

interface GroqResponse {
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

export interface GroqCompletionOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  temperature: number;
  maxTokens: number;
  /**
   * When true, sets OpenAI-compatible `response_format: { type: 'json_object' }`
   * and the returned content is guaranteed by Groq to be syntactically valid
   * JSON. Callers still validate schema via their own parsers.
   */
  expectJson: boolean;
}

export interface GroqCompletionResult {
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

export class GroqApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'GroqApiError';
  }
}

/**
 * Thin, strongly-typed wrapper around the Groq chat completions endpoint
 * (OpenAI-compatible). Stateless per call. Every completion logs duration +
 * token usage so the pipeline orchestrator can aggregate them into AgentRun.
 */
@Injectable()
export class GroqService {
  private readonly logger = new Logger(GroqService.name);
  private readonly http: AxiosInstance;
  private readonly defaultModel: string;

  constructor(
    config: ConfigService,
    private readonly retry: RetryPolicyService,
  ) {
    const agents = config.getOrThrow<AgentsConfig>('agents');
    this.defaultModel = agents.groqModel;

    this.http = axios.create({
      baseURL: agents.groqBaseUrl,
      timeout: agents.groqTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agents.groqApiKey}`,
      },
    });
  }

  /**
   * Perform a chat completion. Callers should pick `expectJson: true` for
   * structured steps (analyzer / decider / executor) and `false` for the
   * responder.
   */
  async complete(options: GroqCompletionOptions): Promise<GroqCompletionResult> {
    const body: GroqRequestBody = {
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
          operation: `groq.complete(${body.model})`,
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 4_000,
          classify: classifyLlmError,
        },
        async () => {
          const response = await this.http.post<GroqResponse>(
            '/chat/completions',
            body,
          );
          const choice = response.data.choices[0];
          if (!choice) {
            throw new GroqApiError(
              'Groq returned no choices in completion response',
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
          apiError?.message ?? axErr.message ?? 'Groq request failed';
        const code = apiError?.code ?? apiError?.type ?? null;
        this.logger.error(
          `Groq call failed after ${durationMs}ms status=${status ?? 'n/a'} code=${code ?? 'n/a'} model=${body.model}: ${message}`,
        );
        throw new GroqApiError(message, status, code);
      }
      if (error instanceof GroqApiError) throw error;
      if (error instanceof Error) {
        this.logger.error(
          `Groq call failed after ${durationMs}ms model=${body.model}: ${error.message}`,
        );
        throw new GroqApiError(error.message, null, null);
      }
      throw new GroqApiError('Unknown Groq error', null, null);
    }
  }
}
