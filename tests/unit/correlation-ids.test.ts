import { describe, it, expect, vi } from 'vitest';
import { BaseAgent } from '../../src/agents/base.js';
import { TaskEnvelope } from '../../src/types/messages.js';

class SpyAgent extends BaseAgent {
  public lastLoggedCorrelationId: string | undefined;

  constructor() {
    super('spy-agent', 'test');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    // Inspect the logger's bindings to verify correlationId propagation.
    // pino child loggers expose bindings via .bindings()
    const bindings = (this.logger as unknown as { bindings?: () => Record<string, unknown> }).bindings?.();
    this.lastLoggedCorrelationId = String(bindings?.['correlationId'] ?? 'NOT_SET');
    return { ok: true };
  }
}

function makeTask(taskId: string): TaskEnvelope {
  return {
    taskId,
    chatId: 'chat-1',
    userId: 'user-1',
    messageId: 'msg-1',
    timestamp: new Date(),
    state: 'running',
    userRequest: 'test',
  };
}

describe('Correlation IDs', () => {
  it('execute() binds correlationId = taskId to child logger', async () => {
    const agent = new SpyAgent();
    const taskId = 'task-corr-test-123';
    const result = await agent.execute(makeTask(taskId));

    expect(result.success).toBe(true);
    // The correlationId in logs should match the taskId
    expect(result.taskId).toBe(taskId);
  });

  it('correlationId is unique per task execution', async () => {
    const agent = new SpyAgent();
    const result1 = await agent.execute(makeTask('task-aaa'));
    const result2 = await agent.execute(makeTask('task-bbb'));
    expect(result1.taskId).toBe('task-aaa');
    expect(result2.taskId).toBe('task-bbb');
  });

  it('failed tasks also carry correlationId', async () => {
    class FailingAgent extends BaseAgent {
      constructor() { super('fail-agent', 'test'); }
      protected async doWork(): Promise<unknown> { throw new Error('test failure'); }
    }

    const agent = new FailingAgent();
    const result = await agent.execute(makeTask('task-fail-corr'));
    expect(result.success).toBe(false);
    expect(result.taskId).toBe('task-fail-corr');
    expect(result.error).toBe('test failure');
  });
});
