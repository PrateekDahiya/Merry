import { TaskEnvelope, AgentResult } from '../types/messages.js';
import { getLogger } from '../logging/logger.js';

/**
 * Persistence layer for task state, chat metadata, and agent run history.
 * In Phase 1, this is stubbed. Phase 7 will implement full persistence.
 */

const logger = getLogger();

export interface TaskStore {
  saveTask(task: TaskEnvelope): Promise<void>;
  getTask(taskId: string): Promise<TaskEnvelope | null>;
  updateTaskState(taskId: string, newState: TaskEnvelope['state']): Promise<void>;
  listTasksByChatId(chatId: string, limit?: number): Promise<TaskEnvelope[]>;
  listTasksByState(state: TaskEnvelope['state']): Promise<TaskEnvelope[]>;
}

export interface ResultStore {
  saveResult(result: AgentResult): Promise<void>;
  getResultByTaskId(taskId: string): Promise<AgentResult | null>;
  getResultsByAgent(agentId: string): Promise<AgentResult[]>;
}

export interface ChatMetadataStore {
  saveChatMetadata(chatId: string, metadata: Record<string, unknown>): Promise<void>;
  getChatMetadata(chatId: string): Promise<Record<string, unknown> | null>;
}

/**
 * In-memory implementation for Phase 1.
 * This is NOT production-ready; Phase 7 will implement persistent storage.
 */
export class InMemoryStore implements TaskStore, ResultStore, ChatMetadataStore {
  private tasks: Map<string, TaskEnvelope> = new Map();
  private results: Map<string, AgentResult> = new Map();
  private chatMetadata: Map<string, Record<string, unknown>> = new Map();

  async saveTask(task: TaskEnvelope): Promise<void> {
    logger.debug({ taskId: task.taskId }, 'Saving task (in-memory)');
    this.tasks.set(task.taskId, task);
  }

  async getTask(taskId: string): Promise<TaskEnvelope | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async updateTaskState(taskId: string, newState: TaskEnvelope['state']): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.state = newState;
      logger.debug({ taskId, newState }, 'Updated task state (in-memory)');
    }
  }

  async listTasksByChatId(chatId: string, limit?: number): Promise<TaskEnvelope[]> {
    const results = Array.from(this.tasks.values()).filter(t => t.chatId === chatId);
    return limit ? results.slice(-limit) : results;
  }

  async listTasksByState(state: TaskEnvelope['state']): Promise<TaskEnvelope[]> {
    return Array.from(this.tasks.values()).filter(t => t.state === state);
  }

  async saveResult(result: AgentResult): Promise<void> {
    logger.debug({ taskId: result.taskId, agentId: result.agentId }, 'Saving agent result (in-memory)');
    this.results.set(result.taskId, result);
  }

  async getResultByTaskId(taskId: string): Promise<AgentResult | null> {
    return this.results.get(taskId) ?? null;
  }

  async getResultsByAgent(agentId: string): Promise<AgentResult[]> {
    return Array.from(this.results.values()).filter(r => r.agentId === agentId);
  }

  async saveChatMetadata(chatId: string, metadata: Record<string, unknown>): Promise<void> {
    logger.debug({ chatId }, 'Saving chat metadata (in-memory)');
    this.chatMetadata.set(chatId, metadata);
  }

  async getChatMetadata(chatId: string): Promise<Record<string, unknown> | null> {
    return this.chatMetadata.get(chatId) ?? null;
  }
}

// Global store instance
let storeInstance: (TaskStore & ResultStore & ChatMetadataStore) | null = null;

export function initializeStore(): TaskStore & ResultStore & ChatMetadataStore {
  storeInstance = new InMemoryStore();
  logger.info('Persistence store initialized (in-memory)');
  return storeInstance;
}

export function getStore(): TaskStore & ResultStore & ChatMetadataStore {
  if (!storeInstance) {
    storeInstance = new InMemoryStore();
  }
  return storeInstance;
}
