import Anthropic from '@anthropic-ai/sdk';

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
 * Deterministic mock that returns structured JSON matching SpecialistOutput.
 * Used when USE_MOCK_AGENTS=true or no API key is configured.
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

export function createLlmClient(options: {
  apiKey?: string;
  mock?: boolean;
  model?: string;
}): LlmClient {
  if (options.mock || !options.apiKey) {
    return new MockLlmClient();
  }
  return new AnthropicClient(options.apiKey, options.model);
}
