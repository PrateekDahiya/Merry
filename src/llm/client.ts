import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';

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

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
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

export type LlmProvider = 'groq' | 'anthropic' | 'mock';

export function createLlmClient(options: {
  provider?: LlmProvider;
  groqApiKey?: string;
  groqModel?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  mock?: boolean;
}): LlmClient {
  if (options.mock) return new MockLlmClient();

  const provider = options.provider ?? detectProvider(options);

  if (provider === 'groq' && options.groqApiKey) {
    return new GroqClient(options.groqApiKey, options.groqModel);
  }
  if (provider === 'anthropic' && options.anthropicApiKey) {
    return new AnthropicClient(options.anthropicApiKey, options.anthropicModel);
  }

  return new MockLlmClient();
}

function detectProvider(options: { groqApiKey?: string; anthropicApiKey?: string }): LlmProvider {
  if (options.groqApiKey) return 'groq';
  if (options.anthropicApiKey) return 'anthropic';
  return 'mock';
}
