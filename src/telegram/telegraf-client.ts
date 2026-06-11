import { Telegraf } from 'telegraf';
import { TelegramMessageMeta } from '../types/messages.js';
import { TelegramClient, SendMessageOptions } from './types.js';

export class TelegrafTelegramClient implements TelegramClient {
  private readonly bot: Telegraf;

  constructor(token: string) {
    this.bot = new Telegraf(token);
  }

  onTextMessage(handler: (message: TelegramMessageMeta) => Promise<void>): void {
    this.bot.on('text', async ctx => {
      const { message } = ctx;
      const { from, chat } = message;

      if (!from || !message.text) {
        return;
      }

      await handler({
        chatId: chat.id,
        messageId: message.message_id,
        userId: from.id,
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        timestamp: new Date(message.date * 1000),
        text: message.text,
        isReply: Boolean(message.reply_to_message),
        replyToMessageId: message.reply_to_message?.message_id,
      });
    });
  }

  async sendChatAction(chatId: number, action: 'typing'): Promise<void> {
    await this.bot.telegram.sendChatAction(chatId, action);
  }

  async sendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<void> {
    await this.bot.telegram.sendMessage(chatId, text, {
      reply_parameters: options?.replyToMessageId
        ? { message_id: options.replyToMessageId }
        : undefined,
    });
  }

  async start(): Promise<void> {
    await this.bot.launch();
  }

  async stop(reason?: string): Promise<void> {
    this.bot.stop(reason);
  }
}
