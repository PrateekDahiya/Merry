import { BaseAgent } from './base.js';
import { TaskEnvelope, TelegramMessageMeta } from '../types/messages.js';
import { splitTelegramMessage } from '../telegram/formatting.js';
import { createTaskFromTelegramMessage } from '../telegram/task-factory.js';
import { TomOptions } from '../telegram/types.js';

/**
 * Tom - Telegram Interface Agent
 *
 * Responsibilities:
 * - Listen for incoming Telegram messages
 * - Send immediate acknowledgment/reaction
 * - Parse chat ID, message ID, sender, text, and metadata
 * - Queue or hand off task to Ace
 * - Receive final response from Ace
 * - Send response back to Telegram
 * - Support replies and formatting for long messages
 *
 * Phase 2 implements Telegram message receipt, acknowledgment, task envelope
 * creation, and handoff to Ace through a dispatcher boundary.
 */
export class TomAgent extends BaseAgent {
  private readonly processedMessages = new Set<string>();
  private readonly acknowledgmentText: string;

  constructor(private readonly options: TomOptions) {
    super('tom-primary', 'tom');
    this.acknowledgmentText = options.acknowledgmentText ?? 'Checking...';
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Tom sending Telegram response');

    const chatId = Number(task.chatId);
    const message = typeof task.context?.telegramResponse === 'string'
      ? task.context.telegramResponse
      : 'Task has been received.';

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
    await this.options.client.sendMessage(message.chatId, this.acknowledgmentText, {
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
}
