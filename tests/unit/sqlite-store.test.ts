import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SqliteStore } from '../../src/persistence/sqlite-store.js';
import { TaskEnvelope, AgentResult } from '../../src/types/messages.js';

const testDir = join(tmpdir(), `merry-sqlite-${Date.now()}`);
const dbPath = join(testDir, 'test.sqlite');

const baseTask: TaskEnvelope = {
  taskId: 'task-sqlite-1',
  chatId: 'chat-1',
  userId: 'user-1',
  messageId: 'msg-1',
  timestamp: new Date('2026-06-12T00:00:00.000Z'),
  state: 'received',
  userRequest: 'Hello SQLite',
};

describe('SqliteStore', () => {
  let store: SqliteStore;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    store = new SqliteStore(dbPath);
  });

  afterEach(() => {
    store.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('saves and retrieves a task', async () => {
    await store.saveTask(baseTask);
    const got = await store.getTask('task-sqlite-1');
    expect(got?.taskId).toBe('task-sqlite-1');
    expect(got?.userRequest).toBe('Hello SQLite');
    expect(got?.timestamp).toBeInstanceOf(Date);
  });

  it('updates task state', async () => {
    await store.saveTask(baseTask);
    await store.updateTaskState('task-sqlite-1', 'completed');
    const got = await store.getTask('task-sqlite-1');
    expect(got?.state).toBe('completed');
  });

  it('lists tasks by chatId in timestamp order', async () => {
    await store.saveTask({ ...baseTask, taskId: 'task-a', timestamp: new Date('2026-01-01') });
    await store.saveTask({ ...baseTask, taskId: 'task-b', timestamp: new Date('2026-01-02') });
    const tasks = await store.listTasksByChatId('chat-1');
    expect(tasks[0]?.taskId).toBe('task-a');
    expect(tasks[1]?.taskId).toBe('task-b');
  });

  it('respects limit in listTasksByChatId', async () => {
    for (let i = 0; i < 5; i++) {
      await store.saveTask({ ...baseTask, taskId: `task-${i}`, messageId: `msg-${i}` });
    }
    const tasks = await store.listTasksByChatId('chat-1', 3);
    expect(tasks.length).toBe(3);
  });

  it('lists tasks by state', async () => {
    await store.saveTask({ ...baseTask, taskId: 'task-run', state: 'running' });
    await store.saveTask({ ...baseTask, taskId: 'task-done', messageId: 'msg-2', state: 'completed' });
    const running = await store.listTasksByState('running');
    expect(running).toHaveLength(1);
    expect(running[0]?.taskId).toBe('task-run');
  });

  it('saves and retrieves results', async () => {
    const result: AgentResult = {
      taskId: 'task-sqlite-1',
      agentId: 'robin-primary',
      success: true,
      result: { answer: 'hello' },
      executionTimeMs: 100,
    };
    await store.saveResult(result);
    const got = await store.getResultByTaskId('task-sqlite-1');
    expect(got?.agentId).toBe('robin-primary');
    expect(got?.success).toBe(true);
  });

  it('saves and retrieves chat metadata', async () => {
    await store.saveChatMetadata('chat-1', { lastSeen: '2026-06-12', username: 'test' });
    const meta = await store.getChatMetadata('chat-1');
    expect(meta?.username).toBe('test');
  });

  it('listAllChatIds returns all registered chats', async () => {
    await store.saveChatMetadata('chat-a', {});
    await store.saveChatMetadata('chat-b', {});
    const ids = await store.listAllChatIds();
    expect(ids).toContain('chat-a');
    expect(ids).toContain('chat-b');
  });

  it('persists data across store instances (same file)', async () => {
    await store.saveTask(baseTask);
    store.close();

    const store2 = new SqliteStore(dbPath);
    const got = await store2.getTask('task-sqlite-1');
    expect(got?.taskId).toBe('task-sqlite-1');
    store2.close();

    // Re-open for afterEach cleanup
    store = new SqliteStore(dbPath);
  });
});
