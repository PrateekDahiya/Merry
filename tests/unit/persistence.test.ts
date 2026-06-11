import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryStore } from '../../src/persistence/store.js';
import { FileStore } from '../../src/persistence/file-store.js';
import { TaskEnvelope, TaskState, AgentResult } from '../../src/types/messages.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const baseTask: TaskEnvelope = {
  taskId: 'task-123',
  chatId: 'chat-123',
  userId: 'user-123',
  messageId: 'msg-123',
  timestamp: new Date('2026-06-11T00:00:00.000Z'),
  state: 'received' as TaskState,
  userRequest: 'Test request',
};

describe('Persistence Store', () => {
  it('should save and retrieve tasks', async () => {
    const store = new InMemoryStore();
    await store.saveTask(baseTask);
    const retrieved = await store.getTask('task-123');
    expect(retrieved).toEqual(baseTask);
  });

  it('should update task state', async () => {
    const store = new InMemoryStore();
    await store.saveTask({ ...baseTask, taskId: 'task-456' });
    await store.updateTaskState('task-456', 'completed' as TaskState);
    const updated = await store.getTask('task-456');
    expect(updated?.state).toBe('completed');
  });

  it('should list tasks by chat ID', async () => {
    const store = new InMemoryStore();
    await store.saveTask({ ...baseTask, taskId: 'task-1', chatId: 'chat-abc' });
    await store.saveTask({ ...baseTask, taskId: 'task-2', chatId: 'chat-abc', state: 'completed' as TaskState });
    const tasks = await store.listTasksByChatId('chat-abc');
    expect(tasks).toHaveLength(2);
  });

  it('should list tasks by state', async () => {
    const store = new InMemoryStore();
    await store.saveTask({ ...baseTask, taskId: 'task-1', state: 'running' as TaskState });
    await store.saveTask({ ...baseTask, taskId: 'task-2', state: 'completed' as TaskState });
    const runningTasks = await store.listTasksByState('running' as TaskState);
    expect(runningTasks).toHaveLength(1);
    expect(runningTasks[0]?.taskId).toBe('task-1');
  });

  it('should save and retrieve chat metadata', async () => {
    const store = new InMemoryStore();
    const metadata = { lastUsedAgent: 'robin', preferences: { theme: 'dark' } };
    await store.saveChatMetadata('chat-xyz', metadata);
    const retrieved = await store.getChatMetadata('chat-xyz');
    expect(retrieved).toEqual(metadata);
  });
});

describe('FileStore', () => {
  const testDir = join(tmpdir(), `merry-file-store-${Date.now()}`);
  const testFile = join(testDir, 'store.json');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('saves a task and reloads it from disk', async () => {
    const store1 = new FileStore(testFile);
    await store1.saveTask(baseTask);
    store1.flush();

    const store2 = new FileStore(testFile);
    const loaded = await store2.getTask('task-123');
    expect(loaded?.taskId).toBe('task-123');
    expect(loaded?.timestamp).toBeInstanceOf(Date);
  });

  it('persists state updates across instances', async () => {
    const store1 = new FileStore(testFile);
    await store1.saveTask(baseTask);
    await store1.updateTaskState('task-123', 'completed');
    store1.flush();

    const store2 = new FileStore(testFile);
    const loaded = await store2.getTask('task-123');
    expect(loaded?.state).toBe('completed');
  });

  it('handles missing file gracefully (starts empty)', async () => {
    const store = new FileStore(join(testDir, 'nonexistent.json'));
    const got = await store.getTask('nope');
    expect(got).toBeNull();
  });

  it('persists and restores results', async () => {
    const result: AgentResult = {
      taskId: 'task-123',
      agentId: 'robin-primary',
      success: true,
      result: { response: 'done' },
      executionTimeMs: 100,
    };

    const store1 = new FileStore(testFile);
    await store1.saveResult(result);
    store1.flush();

    const store2 = new FileStore(testFile);
    const loaded = await store2.getResultByTaskId('task-123');
    expect(loaded?.agentId).toBe('robin-primary');
  });
});
