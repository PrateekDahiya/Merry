import { Telegraf } from 'telegraf';
import { TelegramMessageMeta } from '../types/messages.js';
import { TelegramClient, SendMessageOptions } from './types.js';
import { CommandDeps, registerCommands } from './commands.js';

export class TelegrafTelegramClient implements TelegramClient {
  private readonly bot: Telegraf;

  constructor(token: string, commandDeps?: CommandDeps) {
    this.bot = new Telegraf(token);
    if (commandDeps) {
      registerCommands(this.bot, commandDeps);
    }
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
      parse_mode: 'Markdown',
      reply_parameters: options?.replyToMessageId
        ? { message_id: options.replyToMessageId }
        : undefined,
    });
  }

  async start(): Promise<void> {
    // bot.launch() never resolves while polling — launch without awaiting
    // so startup continues and other agents (Brook, Franky, Luffy) can start
    void this.bot.launch();
    // Give Telegraf a moment to connect before returning
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  async stop(reason?: string): Promise<void> {
    this.bot.stop(reason);
  }
}
