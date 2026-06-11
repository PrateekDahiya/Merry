import { describe, it, expect, beforeEach } from 'vitest';
import { BaseAgent } from '../../src/agents/base.js';
import { TaskEnvelope, TaskState } from '../../src/types/messages.js';

class TestAgent extends BaseAgent {
  constructor() {
    super('test-agent', 'test');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    return { taskId: task.taskId, processed: true };
  }
}

describe('BaseAgent', () => {
  let agent: BaseAgent;

  beforeEach(() => {
    agent = new TestAgent();
  });

  it('should execute a task successfully', async () => {
    const task: TaskEnvelope = {
      taskId: 'test-123',
      chatId: 'chat-123',
      userId: 'user-123',
      messageId: 'msg-123',
      timestamp: new Date(),
      state: 'received' as TaskState,
      userRequest: 'Test request',
    };

    const result = await agent.execute(task);

    expect(result.success).toBe(true);
    expect(result.taskId).toBe('test-123');
    expect(result.agentId).toBe('test-agent');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle errors gracefully', async () => {
    class FailingAgent extends BaseAgent {
      constructor() {
        super('failing-agent', 'test');
      }

      protected async doWork(): Promise<unknown> {
        throw new Error('Test error');
      }
    }

    const failingAgent = new FailingAgent();
    const task: TaskEnvelope = {
      taskId: 'test-fail',
      chatId: 'chat-123',
      userId: 'user-123',
      messageId: 'msg-123',
      timestamp: new Date(),
      state: 'received' as TaskState,
      userRequest: 'Test request',
    };

    const result = await failingAgent.execute(task);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Test error');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should support health checks', async () => {
    const health = await agent.healthCheck();
    expect(health.healthy).toBe(true);
  });
});
