import { BaseAgent } from './base.js';
import { TaskEnvelope, TelegramMessageMeta } from '../types/messages.js';
import { splitTelegramMessage } from '../telegram/formatting.js';
import { createTaskFromTelegramMessage } from '../telegram/task-factory.js';
import { JinbeOptions } from '../telegram/types.js';
import { KnowledgeWriter } from '../knowledge/writer.js';
import { rateLimiter } from '../middleware/rate-limiter.js';

/**
 * Jinbe — the Straw Hat Pirates' helmsman. Former Warlord of the Sea,
 * fishman, and the steadiest hand on the wheel.
 *
 * Jinbe receives every message with honour, acknowledges the user with
 * calm dignity, and gets it to the right hands without hesitation.
 * He is the crew's reliable front door.
 */

export class JinbeAgent extends BaseAgent {
  private readonly processedMessages = new Set<string>();
  private readonly writer?: KnowledgeWriter;

  constructor(private readonly options: JinbeOptions) {
    super('jinbe-primary', 'jinbe');
    if (options.knowledgeDir) {
      this.writer = new KnowledgeWriter(options.knowledgeDir);
    }
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Jinbe delivering message');

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
    this.logger.info('Jinbe at the helm — Telegram listener started');
  }

  async stop(reason = 'shutdown'): Promise<void> {
    await this.options.client.stop(reason);
    this.logger.info({ reason }, 'Jinbe stepping away from the helm — Telegram listener stopped');
  }

  async handleIncomingMessage(message: TelegramMessageMeta): Promise<TaskEnvelope | null> {
    const dedupeKey = `${message.chatId}:${message.messageId}`;

    if (this.processedMessages.has(dedupeKey)) {
      this.logger.info({ dedupeKey }, 'Duplicate Telegram message ignored');
      return null;
    }

    this.processedMessages.add(dedupeKey);

    // Rate limit: 10 requests per minute per chatId
    if (!rateLimiter.allow(String(message.chatId))) {
      const retryAfter = rateLimiter.retryAfterSeconds(String(message.chatId));
      this.logger.warn({ chatId: message.chatId }, 'Rate limit exceeded');
      await this.options.client.sendMessage(
        message.chatId,
        `🌊 Jinbe: With honour, I must ask you to slow down. Even the sea needs time to breathe. Try again in ${retryAfter}s.`,
        { replyToMessageId: message.messageId }
      );
      return null;
    }

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

    // Create initial user profile on first contact (fire and forget)
    if (this.writer && !this.writer.userProfileExists(String(message.chatId))) {
      void this.createInitialProfile(message);
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
    // Just send a typing indicator — Ace's handoff message is the user-visible ack
    await this.options.client.sendChatAction(message.chatId, 'typing');
  }

  async sendFinalResponse(chatId: number, response: string, replyToMessageId?: number): Promise<void> {
    const chunks = splitTelegramMessage(response);

    for (const [index, chunk] of chunks.entries()) {
      await this.options.client.sendMessage(chatId, chunk, {
        replyToMessageId: index === 0 ? replyToMessageId : undefined,
      });
    }
  }

  private async createInitialProfile(message: TelegramMessageMeta): Promise<void> {
    if (!this.writer) return;
    const today = new Date().toISOString().slice(0, 10);
    const nameParts = [message.firstName, message.lastName].filter(Boolean).join(' ');
    const content = [
      `# User Profile`,
      ``,
      `userId: ${message.userId} | chatId: ${message.chatId} | username: ${message.username ?? 'unknown'}`,
      `createdAt: ${today} | lastUpdated: ${today}`,
      ``,
      `## Known About This User`,
      nameParts ? `- Name: ${nameParts}` : null,
      message.username ? `- Telegram: @${message.username}` : null,
    ].filter(Boolean).join('\n');

    try {
      const filePath = this.writer.writeUserProfile(String(message.chatId), content);
      this.logger.info({ chatId: message.chatId, filePath }, 'Jinbe: user profile created');
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Jinbe: failed to create user profile');
    }
  }
}
