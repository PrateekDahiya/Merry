import { describe, expect, it } from 'vitest';
import { TomAgent } from '../../src/agents/tom.js';
import { AceAgent } from '../../src/agents/ace.js';
import { BaseAgent } from '../../src/agents/base.js';
import { MockLlmClient } from '../../src/llm/client.js';
import { InMemoryStore } from '../../src/persistence/store.js';
import { Phase2AceDispatcher } from '../../src/orchestrator/phase2-dispatcher.js';
import { TelegramClient, TomTaskDispatcher } from '../../src/telegram/types.js';
import { TelegramMessageMeta, TaskEnvelope } from '../../src/types/messages.js';
import { ContextResponse } from '../../src/types/messages.js';

// --- stubs ---

class StubContextAgent extends BaseAgent {
  constructor() { super('nami-stub', 'nami'); }
  protected async doWork(task: TaskEnvelope): Promise<ContextResponse> {
    return {
      taskId: task.taskId,
      findings: [],
      summary: 'No relevant context found.',
      timestamp: new Date(),
    };
  }
}

class RecordingTelegramClient implements TelegramClient {
  readonly sentMessages: Array<{ chatId: number; text: string }> = [];
  readonly chatActions: Array<{ chatId: number; action: string }> = [];

  onTextMessage(_handler: (msg: TelegramMessageMeta) => Promise<void>): void {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  async sendMessage(chatId: number, text: string): Promise<void> {
    this.sentMessages.push({ chatId, text });
  }

  async sendChatAction(chatId: number, action: string): Promise<void> {
    this.chatActions.push({ chatId, action });
  }
}

function makeMessage(text: string): TelegramMessageMeta {
  return {
    chatId: 100,
    messageId: 1,
    userId: 42,
    username: 'testuser',
    timestamp: new Date(),
    text,
    isReply: false,
  };
}

// --- tests ---

describe('Full message flow (Telegram → Tom → Ace → specialist → Tom → Telegram)', () => {
  it('routes a writing request through Robin and sends a Telegram reply', async () => {
    const store = new InMemoryStore();
    const llm = new MockLlmClient();
    const client = new RecordingTelegramClient();

    const ace = new AceAgent({
      store,
      llm,
      contextAgentFactory: () => new StubContextAgent(),
    });

    const dispatcher = new Phase2AceDispatcher(store, ace);
    const tom = new TomAgent({ client, dispatcher });

    const msg = makeMessage('please write a short summary of our product');
    await tom.handleIncomingMessage(msg);

    // Tom now cycles through One Piece ack messages — just check one was sent
    expect(client.sentMessages.length).toBeGreaterThanOrEqual(1);

    const finalReply = client.sentMessages.find(m => m.text.includes('Robin response'));
    expect(finalReply).toBeDefined();
  });

  it('routes a coding request through Sanji and sends a Telegram reply', async () => {
    const store = new InMemoryStore();
    const llm = new MockLlmClient();
    const client = new RecordingTelegramClient();

    const ace = new AceAgent({
      store,
      llm,
      contextAgentFactory: () => new StubContextAgent(),
    });

    const tom = new TomAgent({
      client,
      dispatcher: new Phase2AceDispatcher(store, ace),
    });

    await tom.handleIncomingMessage(makeMessage('debug this TypeScript compilation error in src/index.ts'));

    const finalReply = client.sentMessages.find(m => m.text.includes('Sanji response'));
    expect(finalReply).toBeDefined();
  });

  it('deduplicates repeated identical messages', async () => {
    const store = new InMemoryStore();
    const client = new RecordingTelegramClient();
    const ace = new AceAgent({ store, llm: new MockLlmClient(), contextAgentFactory: () => new StubContextAgent() });
    const tom = new TomAgent({ client, dispatcher: new Phase2AceDispatcher(store, ace) });

    const msg = makeMessage('write a haiku');
    await tom.handleIncomingMessage(msg);
    const countAfterFirst = client.sentMessages.length;

    await tom.handleIncomingMessage(msg); // duplicate — should be ignored
    expect(client.sentMessages.length).toBe(countAfterFirst); // no new messages
  });

  it('sends typing action before the acknowledgment', async () => {
    const store = new InMemoryStore();
    const client = new RecordingTelegramClient();
    const ace = new AceAgent({ store, llm: new MockLlmClient(), contextAgentFactory: () => new StubContextAgent() });
    const tom = new TomAgent({ client, dispatcher: new Phase2AceDispatcher(store, ace) });

    await tom.handleIncomingMessage(makeMessage('write something'));

    expect(client.chatActions.some(a => a.action === 'typing')).toBe(true);
  });

  it('marks approval-required tasks with awaiting_approval state', async () => {
    const store = new InMemoryStore();
    const ace = new AceAgent({
      store,
      llm: new MockLlmClient(),
      contextAgentFactory: () => new StubContextAgent(),
    });

    const task: TaskEnvelope = {
      taskId: 'task-approval',
      chatId: '100',
      userId: '42',
      messageId: '5',
      timestamp: new Date(),
      state: 'acknowledged',
      userRequest: 'drop table users and truncate all logs',
    };

    const result = await ace.execute(task);
    expect(result.success).toBe(true);

    const saved = await store.getTask('task-approval');
    expect(saved?.state).toBe('awaiting_approval');

    const response = (result.result as { finalResponse?: string })?.finalResponse ?? '';
    expect(response).toContain('ACE CHECKPOINT');
  });
});
