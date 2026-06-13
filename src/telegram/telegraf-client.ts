import { Telegraf } from 'telegraf';
import { TelegramMessageMeta } from '../types/messages.js';
import { TelegramClient, SendMessageOptions } from './types.js';
import { CommandDeps, registerCommands } from './commands.js';
import { extractDocumentText, buildDocumentMessage } from './document-handler.js';

export class TelegrafTelegramClient implements TelegramClient {
  private readonly bot: Telegraf;

  constructor(token: string, commandDeps?: CommandDeps) {
    this.bot = new Telegraf(token);
    if (commandDeps) {
      registerCommands(this.bot, commandDeps);
    }
  }

  onTextMessage(handler: (message: TelegramMessageMeta) => Promise<void>): void {
    // Handle document uploads (PDF, text files, code, etc.)
    this.bot.on('document', async ctx => {
      const doc = ctx.message.document;
      if (!doc?.file_id) return;
      try {
        const fileLink = await ctx.telegram.getFileLink(doc.file_id);
        const res = await fetch(fileLink.toString());
        const buffer = Buffer.from(await res.arrayBuffer());
        const extracted = await extractDocumentText(buffer, doc.mime_type ?? 'application/octet-stream', doc.file_name ?? 'document');
        const text = buildDocumentMessage(extracted, ctx.message.caption ?? undefined);
        await handler({
          chatId: ctx.message.chat.id,
          messageId: ctx.message.message_id,
          userId: ctx.message.from?.id ?? 0,
          username: ctx.message.from?.username,
          firstName: ctx.message.from?.first_name,
          lastName: ctx.message.from?.last_name,
          timestamp: new Date(ctx.message.date * 1000),
          text,
          isReply: false,
        });
      } catch (err) {
        await ctx.reply('🗺️ Nami: Could not read that document. ' + String(err));
      }
    });

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
