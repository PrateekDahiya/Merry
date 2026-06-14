import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { TaskEnvelope, AgentResult } from '../types/messages.js';
import { TaskStore, ResultStore, ChatMetadataStore } from './store.js';
import { getLogger } from '../logging/logger.js';

const logger = getLogger();

/**
 * SQLite-backed persistent store.
 *
 * Uses WAL mode for concurrent read access (multiple agents reading simultaneously).
 * All JSON is stored as TEXT; Date objects are stored as ISO strings and revived on read.
 * Indexed on chatId, state, and timestamp for fast queries.
 */
export class SqliteStore implements TaskStore, ResultStore, ChatMetadataStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    logger.info({ dbPath }, 'SqliteStore initialized');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id      TEXT PRIMARY KEY,
        chat_id      TEXT NOT NULL,
        state        TEXT NOT NULL,
        user_request TEXT NOT NULL,
        timestamp    INTEGER NOT NULL,
        data         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_chat ON tasks (chat_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks (state);

      CREATE TABLE IF NOT EXISTS results (
        task_id  TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        data     TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_metadata (
        chat_id    TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  // ── TaskStore ────────────────────────────────────────────────────────────

  async saveTask(task: TaskEnvelope): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO tasks (task_id, chat_id, state, user_request, timestamp, data)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      task.taskId,
      task.chatId,
      task.state,
      task.userRequest,
      new Date(task.timestamp).getTime(),
      JSON.stringify(task),
    );
  }

  async getTask(taskId: string): Promise<TaskEnvelope | null> {
    const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(taskId) as { data: string } | undefined;
    return row ? this.reviveTask(JSON.parse(row.data)) : null;
  }

  async updateTaskState(taskId: string, newState: TaskEnvelope['state']): Promise<void> {
    const row = this.db.prepare('SELECT data FROM tasks WHERE task_id = ?').get(taskId) as { data: string } | undefined;
    if (!row) return;
    const task = this.reviveTask(JSON.parse(row.data));
    task.state = newState;
    this.db.prepare('UPDATE tasks SET state = ?, data = ? WHERE task_id = ?')
      .run(newState, JSON.stringify(task), taskId);
  }

  async listTasksByChatId(chatId: string, limit?: number): Promise<TaskEnvelope[]> {
    if (limit) {
      // DESC + LIMIT gets the most recent N, then reverse to return oldest-first (matches InMemoryStore).
      const rows = this.db.prepare(
        'SELECT data FROM tasks WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
      ).all(chatId, limit) as { data: string }[];
      return rows.map(r => this.reviveTask(JSON.parse(r.data))).reverse();
    }
    const rows = this.db.prepare(
      'SELECT data FROM tasks WHERE chat_id = ? ORDER BY timestamp ASC'
    ).all(chatId) as { data: string }[];
    return rows.map(r => this.reviveTask(JSON.parse(r.data)));
  }

  async listTasksByState(state: TaskEnvelope['state']): Promise<TaskEnvelope[]> {
    const rows = this.db.prepare('SELECT data FROM tasks WHERE state = ?').all(state) as { data: string }[];
    return rows.map(r => this.reviveTask(JSON.parse(r.data)));
  }

  // ── ResultStore ──────────────────────────────────────────────────────────

  async saveResult(result: AgentResult): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO results (task_id, agent_id, data) VALUES (?, ?, ?)
    `).run(result.taskId, result.agentId, JSON.stringify(result));
  }

  async getResultByTaskId(taskId: string): Promise<AgentResult | null> {
    const row = this.db.prepare('SELECT data FROM results WHERE task_id = ?').get(taskId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AgentResult) : null;
  }

  async getResultsByAgent(agentId: string): Promise<AgentResult[]> {
    const rows = this.db.prepare('SELECT data FROM results WHERE agent_id = ?').all(agentId) as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as AgentResult);
  }

  // ── ChatMetadataStore ─────────────────────────────────────────────────────

  async saveChatMetadata(chatId: string, metadata: Record<string, unknown>): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO chat_metadata (chat_id, data, updated_at) VALUES (?, ?, ?)
    `).run(chatId, JSON.stringify(metadata), Date.now());
  }

  async getChatMetadata(chatId: string): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare('SELECT data FROM chat_metadata WHERE chat_id = ?').get(chatId) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
  }

  async listAllChatIds(): Promise<string[]> {
    const rows = this.db.prepare('SELECT chat_id FROM chat_metadata').all() as { chat_id: string }[];
    return rows.map(r => r.chat_id);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private reviveTask(raw: Record<string, unknown>): TaskEnvelope {
    if (typeof raw['timestamp'] === 'string') {
      raw['timestamp'] = new Date(raw['timestamp'] as string);
    } else if (typeof raw['timestamp'] === 'number') {
      raw['timestamp'] = new Date(raw['timestamp'] as number);
    }
    return raw as unknown as TaskEnvelope;
  }

  /** Close the database connection (call on shutdown). */
  close(): void {
    this.db.close();
  }
}
