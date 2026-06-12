import { describe, expect, it } from 'vitest';
import { JinbeAgent } from '../../src/agents/jinbe.js';
import { splitTelegramMessage } from '../../src/telegram/formatting.js';
import { TelegramClient, JinbeTaskDispatcher } from '../../src/telegram/types.js';
import { TaskEnvelope, TelegramMessageMeta } from '../../src/types/messages.js';

class MockTelegramClient implements TelegramClient {
  readonly sentMessages: Array<{ chatId: number; text: string; replyToMessageId?: number }> = [];
  readonly chatActions: Array<{ chatId: number; action: 'typing' }> = [];
  private handler: ((message: TelegramMessageMeta) => Promise<void>) | null = null;

  onTextMessage(handler: (message: TelegramMessageMeta) => Promise<void>): void {
    this.handler = handler;
  }

  async sendChatAction(chatId: number, action: 'typing'): Promise<void> {
    this.chatActions.push({ chatId, action });
  }

  async sendMessage(chatId: number, text: string, options?: { replyToMessageId?: number }): Promise<void> {
    this.sentMessages.push({ chatId, text, replyToMessageId: options?.replyToMessageId });
  }

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }

  async emit(message: TelegramMessageMeta): Promise<void> {
    await this.handler?.(message);
  }
}

class RecordingDispatcher implements JinbeTaskDispatcher {
  readonly tasks: TaskEnvelope[] = [];

  constructor(private readonly response?: string) {}

  async dispatch(task: TaskEnvelope): Promise<string | void> {
    this.tasks.push(task);
    return this.response;
  }
}

function createTelegramMessage(overrides: Partial<TelegramMessageMeta> = {}): TelegramMessageMeta {
  return {
    chatId: 100,
    messageId: 200,
    userId: 300,
    username: 'tester',
    firstName: 'Test',
    timestamp: new Date('2026-06-11T00:00:00.000Z'),
    text: 'Please summarize this',
    isReply: false,
    ...overrides,
  };
}

describe('Telegram formatting', () => {
  it('splits long Telegram messages within the max length', () => {
    const chunks = splitTelegramMessage('a '.repeat(5000), 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 100)).toBe(true);
  });
});

describe('JinbeAgent', () => {
  it('acknowledges Telegram messages and dispatches task envelopes to Ace boundary', async () => {
    const client = new MockTelegramClient();
    const dispatcher = new RecordingDispatcher('Final response');
    const jinbe = new JinbeAgent({ client, dispatcher });

    const task = await jinbe.handleIncomingMessage(createTelegramMessage());

    expect(task).not.toBeNull();
    expect(task?.state).toBe('acknowledged');
    expect(task?.assignedAgent).toBe('ace');
    expect(task?.chatId).toBe('100');
    expect(dispatcher.tasks).toHaveLength(1);
    expect(client.chatActions).toEqual([{ chatId: 100, action: 'typing' }]);
    // Jinbe now cycles through One Piece acknowledgment messages
    expect(client.sentMessages[0]?.chatId).toBe(100);
    expect(client.sentMessages[0]?.text).toBeTruthy();
    expect(client.sentMessages[0]?.replyToMessageId).toBe(200);
    expect(client.sentMessages[1]).toEqual({
      chatId: 100,
      text: 'Final response',
      replyToMessageId: 200,
    });
  });

  it('ignores duplicate Telegram messages', async () => {
    const client = new MockTelegramClient();
    const dispatcher = new RecordingDispatcher();
    const jinbe = new JinbeAgent({ client, dispatcher });
    const message = createTelegramMessage();

    await jinbe.handleIncomingMessage(message);
    const duplicate = await jinbe.handleIncomingMessage(message);

    expect(duplicate).toBeNull();
    expect(dispatcher.tasks).toHaveLength(1);
  });

  it('registers the Telegram text handler when started', async () => {
    const client = new MockTelegramClient();
    const dispatcher = new RecordingDispatcher();
    const jinbe = new JinbeAgent({ client, dispatcher });

    await jinbe.start();
    await client.emit(createTelegramMessage({ messageId: 201 }));

    expect(dispatcher.tasks).toHaveLength(1);
  });
});
