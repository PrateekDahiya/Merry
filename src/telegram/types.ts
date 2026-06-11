import { TelegramMessageMeta, TaskEnvelope } from '../types/messages.js';

export interface SendMessageOptions {
  replyToMessageId?: number;
}

export interface TelegramClient {
  onTextMessage(handler: (message: TelegramMessageMeta) => Promise<void>): void;
  sendChatAction(chatId: number, action: 'typing'): Promise<void>;
  sendMessage(chatId: number, text: string, options?: SendMessageOptions): Promise<void>;
  start(): Promise<void>;
  stop(reason?: string): Promise<void>;
}

export interface TomTaskDispatcher {
  dispatch(task: TaskEnvelope): Promise<string | void>;
}

export interface TomOptions {
  client: TelegramClient;
  dispatcher: TomTaskDispatcher;
  acknowledgmentText?: string;
}
