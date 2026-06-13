import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { groqBreaker, anthropicBreaker, ollamaBreaker } from '../utils/circuit-breaker.js';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
}

export interface LlmResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmClient {
  chat(request: LlmRequest): Promise<LlmResponse>;
}

export class GroqClient implements LlmClient {
  private readonly client: Groq;
  private readonly model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const messages: Groq.Chat.ChatCompletionMessageParam[] = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    for (const msg of request.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    return groqBreaker.call(async () => {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 2048,
        messages,
      });
      return {
        content: completion.choices[0]?.message?.content ?? '',
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      };
    });
  }
}

export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    return anthropicBreaker.call(async () => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 2048,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages,
      });
      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');
      return { content, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    });
  }
}

/**
 * Deterministic mock — returns structured JSON matching SpecialistOutput.
 * Used when USE_MOCK_AGENTS=true or no API key is set.
 */
export class MockLlmClient implements LlmClient {
  async chat(request: LlmRequest): Promise<LlmResponse> {
    const lastMessage = request.messages[request.messages.length - 1];
    const userContent = lastMessage?.content ?? '';
    const isWriting = request.system?.includes('Robin') ?? false;

    const structured = isWriting
      ? {
          title: 'Writing synthesis',
          response: `Robin response: ${userContent.substring(0, 200).trim()}.`,
          summary: 'Robin converted the request into a concise editorial response.',
          nextSteps: ['Review tone', 'Check for missing audience constraints', 'Refine wording if needed'],
          warnings: [],
          requiresApproval: false,
        }
      : {
          title: 'Implementation plan',
          response: `Sanji response: implement the request by breaking it into small, testable steps for ${userContent.substring(0, 200).trim()}.`,
          summary: 'Sanji produced a code-focused response with safety-minded implementation guidance.',
          nextSteps: ['Identify touched files', 'Add tests first', 'Apply changes incrementally'],
          warnings: ['Destructive or broad refactors require Ace approval before execution.'],
          requiresApproval: false,
        };

    return {
      content: JSON.stringify(structured),
      inputTokens: 100,
      outputTokens: 50,
    };
  }
}

/**
 * Ollama — local LLM, no API key needed, no rate limits.
 * Great for batch background tasks like Zoro's file summarisation.
 *
 * Default URL: http://localhost:11434
 * In Docker, use http://host.docker.internal:11434 to reach the host machine.
 */
export class OllamaClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'llama3.2') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const messages: Array<{ role: string; content: string }> = [];

    if (request.system) {
      messages.push({ role: 'system', content: request.system });
    }
    for (const msg of request.messages) {
      messages.push({ role: msg.role, content: msg.content });
    }

    return ollamaBreaker.call(() => this._ollamaRequest(messages, request.maxTokens));
  }

  private async _ollamaRequest(messages: Array<{ role: string; content: string }>, maxTokens?: number): Promise<LlmResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: { num_predict: maxTokens ?? 2048 },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body}`);
    }

    const data = await res.json() as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content ?? '',
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
    };
  }
}

export type LlmProvider = 'groq' | 'anthropic' | 'ollama' | 'mock';

export interface LlmClientOptions {
  provider?: LlmProvider;
  // Groq
  groqApiKey?: string;
  groqModel?: string;
  // Anthropic
  anthropicApiKey?: string;
  anthropicModel?: string;
  // Ollama
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  // Fallback
  mock?: boolean;
}

/**
 * Wraps any LlmClient with an LRU response cache.
 * Skips cache for very short requests (routing classifier — maxTokens ≤ 5).
 */
export class CachedLlmClient implements LlmClient {
  constructor(private readonly inner: LlmClient) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    // Don't cache ultra-short routing calls (maxTokens ≤ 5) — they're already fast
    if ((request.maxTokens ?? 9999) <= 5) return this.inner.chat(request);

    const { getCachedResponse, setCachedResponse } = await import('./cache.js');
    const cached = getCachedResponse(request);
    if (cached) return cached;

    const response = await this.inner.chat(request);
    setCachedResponse(request, response);
    return response;
  }
}

export function createLlmClient(options: LlmClientOptions): LlmClient {
  if (options.mock) return new MockLlmClient();

  const provider = options.provider ?? detectProvider(options);

  let base: LlmClient;
  if (provider === 'ollama') {
    base = new OllamaClient(options.ollamaBaseUrl, options.ollamaModel);
  } else if (provider === 'groq' && options.groqApiKey) {
    base = new GroqClient(options.groqApiKey, options.groqModel);
  } else if (provider === 'anthropic' && options.anthropicApiKey) {
    base = new AnthropicClient(options.anthropicApiKey, options.anthropicModel);
  } else {
    return new MockLlmClient();
  }

  // Wrap with cache (skipped for ultra-short routing calls)
  return new CachedLlmClient(base);
}

function detectProvider(options: LlmClientOptions): LlmProvider {
  // Cloud providers take priority when API keys are present.
  // Ollama is the fallback of last resort — having ollamaBaseUrl set should
  // never override an explicit cloud key (e.g. localhost:11434 in .env should
  // not hijack Robin when GROQ_API_KEY is also set).
  if (options.groqApiKey) return 'groq';
  if (options.anthropicApiKey) return 'anthropic';
  if (options.ollamaBaseUrl) return 'ollama';
  return 'mock';
}
