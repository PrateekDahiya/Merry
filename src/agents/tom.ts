import { BaseAgent } from './base.js';
import { TaskEnvelope, TelegramMessageMeta } from '../types/messages.js';
import { splitTelegramMessage } from '../telegram/formatting.js';
import { createTaskFromTelegramMessage } from '../telegram/task-factory.js';
import { TomOptions } from '../telegram/types.js';

/**
 * Tom — inspired by Tom-san, the legendary shipwright who built the Oro Jackson
 * and believed ships should bring smiles to people's faces.
 *
 * Tom receives every incoming message, greets the user warmly, and immediately
 * gets it to the right hands. He is the front door of the crew.
 */

const ACK_MESSAGES = [
  '⚓ Leave it to me! Routing to Ace now...',
  '🔧 Tom on it! The crew will handle this.',
  '⛵ Got your message! Setting sail for an answer...',
  '🌊 Received! Passing this to Ace right away.',
  '🏴‍☠️ Aye! The Straw Hats are on the case.',
];

export class TomAgent extends BaseAgent {
  private readonly processedMessages = new Set<string>();
  private readonly acknowledgmentText: string;
  private ackIndex = 0;

  constructor(private readonly options: TomOptions) {
    super('tom-primary', 'tom');
    this.acknowledgmentText = options.acknowledgmentText ?? '';
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Tom sending Telegram response');

    const chatId = Number(task.chatId);
    const message = typeof task.context?.telegramResponse === 'string'
      ? task.context.telegramResponse
      : 'Your request has been received.';

    await this.sendFinalResponse(chatId, message, Number(task.messageId));
    return { sent: true };
  }

  async start(): Promise<void> {
    this.options.client.onTextMessage(async message => {
      await this.handleIncomingMessage(message);
    });

    await this.options.client.start();
    this.logger.info('Tom Telegram listener started');
  }

  async stop(reason = 'shutdown'): Promise<void> {
    await this.options.client.stop(reason);
    this.logger.info({ reason }, 'Tom Telegram listener stopped');
  }

  async handleIncomingMessage(message: TelegramMessageMeta): Promise<TaskEnvelope | null> {
    const dedupeKey = `${message.chatId}:${message.messageId}`;

    if (this.processedMessages.has(dedupeKey)) {
      this.logger.info({ dedupeKey }, 'Duplicate Telegram message ignored');
      return null;
    }

    this.processedMessages.add(dedupeKey);
    this.logger.info(
      { chatId: message.chatId, messageId: message.messageId, userId: message.userId },
      'Telegram message received'
    );

    // Register chat so CrewScheduler knows who to message proactively
    if (this.options.store) {
      const existing = (await this.options.store.getChatMetadata(String(message.chatId))) ?? {};
      void this.options.store.saveChatMetadata(String(message.chatId), {
        ...existing,
        chatId: String(message.chatId),
        username: message.username,
        firstName: message.firstName,
        lastSeenAt: new Date().toISOString(),
      });
    }

    await this.acknowledge(message);

    const task = createTaskFromTelegramMessage(message);
    const finalResponse = await this.options.dispatcher.dispatch(task);

    if (finalResponse) {
      await this.sendFinalResponse(message.chatId, finalResponse, message.messageId);
    }

    return task;
  }

  async acknowledge(message: TelegramMessageMeta): Promise<void> {
    await this.options.client.sendChatAction(message.chatId, 'typing');

    const ack = this.acknowledgmentText || this.nextAck();
    await this.options.client.sendMessage(message.chatId, ack, {
      replyToMessageId: message.messageId,
    });
  }

  async sendFinalResponse(chatId: number, response: string, replyToMessageId?: number): Promise<void> {
    const chunks = splitTelegramMessage(response);

    for (const [index, chunk] of chunks.entries()) {
      await this.options.client.sendMessage(chatId, chunk, {
        replyToMessageId: index === 0 ? replyToMessageId : undefined,
      });
    }
  }

  private nextAck(): string {
    const msg = ACK_MESSAGES[this.ackIndex % ACK_MESSAGES.length]!;
    this.ackIndex++;
    return msg;
  }
}
