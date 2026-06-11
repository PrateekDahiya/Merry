import { describe, it, expect } from 'vitest';
import { InMemoryStore } from '../../src/persistence/store.js';
import { TaskEnvelope, TaskState } from '../../src/types/messages.js';

describe('Persistence Store', () => {
  it('should save and retrieve tasks', async () => {
    const store = new InMemoryStore();
    const task: TaskEnvelope = {
      taskId: 'task-123',
      chatId: 'chat-123',
      userId: 'user-123',
      messageId: 'msg-123',
      timestamp: new Date(),
      state: 'received' as TaskState,
      userRequest: 'Test request',
    };

    await store.saveTask(task);
    const retrieved = await store.getTask('task-123');

    expect(retrieved).toEqual(task);
  });

  it('should update task state', async () => {
    const store = new InMemoryStore();
    const task: TaskEnvelope = {
      taskId: 'task-456',
      chatId: 'chat-123',
      userId: 'user-123',
      messageId: 'msg-123',
      timestamp: new Date(),
      state: 'received' as TaskState,
      userRequest: 'Test request',
    };

    await store.saveTask(task);
    await store.updateTaskState('task-456', 'completed' as TaskState);
    const updated = await store.getTask('task-456');

    expect(updated?.state).toBe('completed');
  });

  it('should list tasks by chat ID', async () => {
    const store = new InMemoryStore();

    const task1: TaskEnvelope = {
      taskId: 'task-1',
      chatId: 'chat-abc',
      userId: 'user-123',
      messageId: 'msg-123',
      timestamp: new Date(),
      state: 'received' as TaskState,
      userRequest: 'Request 1',
    };

    const task2: TaskEnvelope = {
      taskId: 'task-2',
      chatId: 'chat-abc',
      userId: 'user-123',
      messageId: 'msg-124',
      timestamp: new Date(),
      state: 'completed' as TaskState,
      userRequest: 'Request 2',
    };

    await store.saveTask(task1);
    await store.saveTask(task2);

    const tasks = await store.listTasksByChatId('chat-abc');
    expect(tasks).toHaveLength(2);
  });

  it('should list tasks by state', async () => {
    const store = new InMemoryStore();

    const task1: TaskEnvelope = {
      taskId: 'task-1',
      chatId: 'chat-123',
      userId: 'user-123',
      messageId: 'msg-123',
      timestamp: new Date(),
      state: 'running' as TaskState,
      userRequest: 'Request 1',
    };

    const task2: TaskEnvelope = {
      taskId: 'task-2',
      chatId: 'chat-123',
      userId: 'user-123',
      messageId: 'msg-124',
      timestamp: new Date(),
      state: 'completed' as TaskState,
      userRequest: 'Request 2',
    };

    await store.saveTask(task1);
    await store.saveTask(task2);

    const runningTasks = await store.listTasksByState('running' as TaskState);
    expect(runningTasks).toHaveLength(1);
    expect(runningTasks[0].taskId).toBe('task-1');
  });

  it('should save and retrieve chat metadata', async () => {
    const store = new InMemoryStore();
    const metadata = { lastUsedAgent: 'robin', preferences: { theme: 'dark' } };

    await store.saveChatMetadata('chat-xyz', metadata);
    const retrieved = await store.getChatMetadata('chat-xyz');

    expect(retrieved).toEqual(metadata);
  });
});
