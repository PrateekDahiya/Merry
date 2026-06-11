import { TelegramMessageMeta, TaskEnvelope } from '../types/messages.js';
import { generateTaskId } from '../utils/id-generator.js';

export function createTaskFromTelegramMessage(message: TelegramMessageMeta): TaskEnvelope {
  return {
    taskId: generateTaskId(),
    chatId: String(message.chatId),
    userId: String(message.userId),
    messageId: String(message.messageId),
    timestamp: message.timestamp,
    state: 'acknowledged',
    userRequest: message.text,
    assignedAgent: 'ace',
    metadata: {
      source: 'telegram',
      telegram: {
        username: message.username,
        firstName: message.firstName,
        lastName: message.lastName,
        isReply: message.isReply,
        replyToMessageId: message.replyToMessageId,
      },
    },
  };
}
