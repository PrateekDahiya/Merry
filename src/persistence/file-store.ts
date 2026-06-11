import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { dirname } from 'path';
import { TaskEnvelope, AgentResult } from '../types/messages.js';
import { TaskStore, ResultStore, ChatMetadataStore } from './store.js';
import { getLogger } from '../logging/logger.js';

const logger = getLogger();

interface StoreSnapshot {
  tasks: Record<string, unknown>;
  results: Record<string, unknown>;
  chatMetadata: Record<string, Record<string, unknown>>;
}

function dateReviver(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return value;
}

/**
 * File-backed persistent store.
 *
 * Uses an in-memory cache with debounced atomic writes (tmp-rename) to disk.
 * Survives process restarts; no native modules required.
 */
export class FileStore implements TaskStore, ResultStore, ChatMetadataStore {
  private readonly tasks: Map<string, TaskEnvelope> = new Map();
  private readonly results: Map<string, AgentResult> = new Map();
  private readonly chatMetadata: Map<string, Record<string, unknown>> = new Map();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly filePath: string) {
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const snapshot = JSON.parse(raw, dateReviver) as StoreSnapshot;

      for (const [k, v] of Object.entries(snapshot.tasks ?? {})) {
        const parsed = TaskEnvelope.safeParse(v);
        if (parsed.success) this.tasks.set(k, parsed.data);
      }

      for (const [k, v] of Object.entries(snapshot.results ?? {})) {
        const parsed = AgentResult.safeParse(v);
        if (parsed.success) this.results.set(k, parsed.data);
      }

      for (const [k, v] of Object.entries(snapshot.chatMetadata ?? {})) {
        this.chatMetadata.set(k, v);
      }

      logger.info(
        { filePath: this.filePath, tasks: this.tasks.size, results: this.results.size },
        'FileStore loaded from disk'
      );
    } catch (err) {
      logger.warn({ filePath: this.filePath, err: String(err) }, 'FileStore: could not load existing data, starting fresh');
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flush();
      this.flushTimer = null;
    }, 250);
  }

  flush(): void {
    const snapshot: StoreSnapshot = {
      tasks: Object.fromEntries(this.tasks),
      results: Object.fromEntries(this.results),
      chatMetadata: Object.fromEntries(this.chatMetadata),
    };

    const tmp = `${this.filePath}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
      renameSync(tmp, this.filePath);
    } catch (err) {
      logger.error({ filePath: this.filePath, err: String(err) }, 'FileStore flush failed');
    }
  }

  async saveTask(task: TaskEnvelope): Promise<void> {
    this.tasks.set(task.taskId, task);
    this.scheduleFlush();
  }

  async getTask(taskId: string): Promise<TaskEnvelope | null> {
    return this.tasks.get(taskId) ?? null;
  }

  async updateTaskState(taskId: string, newState: TaskEnvelope['state']): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      this.tasks.set(taskId, { ...task, state: newState });
      this.scheduleFlush();
    }
  }

  async listTasksByChatId(chatId: string, limit?: number): Promise<TaskEnvelope[]> {
    const all = Array.from(this.tasks.values()).filter(t => t.chatId === chatId);
    return limit ? all.slice(-limit) : all;
  }

  async listTasksByState(state: TaskEnvelope['state']): Promise<TaskEnvelope[]> {
    return Array.from(this.tasks.values()).filter(t => t.state === state);
  }

  async saveResult(result: AgentResult): Promise<void> {
    this.results.set(result.taskId, result);
    this.scheduleFlush();
  }

  async getResultByTaskId(taskId: string): Promise<AgentResult | null> {
    return this.results.get(taskId) ?? null;
  }

  async getResultsByAgent(agentId: string): Promise<AgentResult[]> {
    return Array.from(this.results.values()).filter(r => r.agentId === agentId);
  }

  async saveChatMetadata(chatId: string, metadata: Record<string, unknown>): Promise<void> {
    this.chatMetadata.set(chatId, metadata);
    this.scheduleFlush();
  }

  async getChatMetadata(chatId: string): Promise<Record<string, unknown> | null> {
    return this.chatMetadata.get(chatId) ?? null;
  }
}
