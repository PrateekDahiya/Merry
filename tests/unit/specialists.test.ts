import { describe, expect, it } from 'vitest';
import { RobinAgent } from '../../src/agents/robin.js';
import { SanjiAgent } from '../../src/agents/sanji.js';
import { SpecialistOutput } from '../../src/agents/specialists.js';
import { MockLlmClient } from '../../src/llm/client.js';
import { TaskEnvelope } from '../../src/types/messages.js';

function createTask(userRequest: string, context: Record<string, unknown> = {}): TaskEnvelope {
  return {
    taskId: 'task-specialist',
    chatId: 'chat-specialist',
    userId: 'user-specialist',
    messageId: 'msg-specialist',
    timestamp: new Date('2026-06-11T00:00:00.000Z'),
    state: 'running',
    userRequest,
    assignedAgent: 'robin',
    context,
  };
}

describe('specialist workers', () => {
  it('produces structured Robin output with writing-oriented language', async () => {
    const robin = new RobinAgent(new MockLlmClient());
    const result = await robin.execute(createTask('write a polished summary', { audience: 'executives' }));

    expect(result.success).toBe(true);
    expect(SpecialistOutput.safeParse(result.result).success).toBe(true);

    const output = SpecialistOutput.parse(result.result);
    expect(output.specialist).toBe('robin');
    expect(output.title).toBe('Writing synthesis');
    expect(output.response).toContain('Robin response');
    expect(output.prompt).toContain('write a polished summary');
  });

  it('produces structured Sanji output with coding-oriented language', async () => {
    const sanji = new SanjiAgent(new MockLlmClient());
    const result = await sanji.execute(
      createTask('implement a retryable queue', { files: ['src/index.ts', 'src/queue.ts'] })
    );

    expect(result.success).toBe(true);
    expect(SpecialistOutput.safeParse(result.result).success).toBe(true);

    const output = SpecialistOutput.parse(result.result);
    expect(output.specialist).toBe('sanji');
    expect(output.title).toBe('Implementation plan');
    expect(output.response).toContain('Sanji response');
    expect(output.prompt).toContain('implement a retryable queue');
    expect(output.warnings).toContain('Destructive or broad refactors require Ace approval before execution.');
  });

  it('flags destructive requests for approval', async () => {
    const sanji = new SanjiAgent(new MockLlmClient());
    const result = await sanji.execute(
      createTask('drop table users and truncate all logs')
    );

    expect(result.success).toBe(true);
    const output = SpecialistOutput.parse(result.result);
    expect(output.requiresApproval).toBe(true);
    expect(output.warnings.length).toBeGreaterThan(0);
  });

  it('does not flag normal requests for approval', async () => {
    const sanji = new SanjiAgent(new MockLlmClient());
    const result = await sanji.execute(
      createTask('add a retry helper function to queue.ts')
    );

    expect(result.success).toBe(true);
    const output = SpecialistOutput.parse(result.result);
    expect(output.requiresApproval).toBe(false);
  });
});
