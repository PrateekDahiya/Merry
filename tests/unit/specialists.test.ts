import { describe, expect, it } from 'vitest';
import { RobinAgent } from '../../src/agents/robin.js';
import { SanjiAgent } from '../../src/agents/sanji.js';
import { SpecialistOutput } from '../../src/agents/specialists.js';
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
    const robin = new RobinAgent();
    const result = await robin.execute(createTask('write a polished summary', { audience: 'executives' }));

    expect(result.success).toBe(true);
    expect(SpecialistOutput.safeParse(result.result).success).toBe(true);

    const output = SpecialistOutput.parse(result.result);
    expect(output.specialist).toBe('robin');
    expect(output.title).toBe('Writing synthesis');
    expect(output.response).toContain('Robin response');
    expect(output.prompt).toContain('writing specialist');
    expect(output.prompt).toContain('audience');
  });

  it('produces structured Sanji output with coding-oriented language', async () => {
    const sanji = new SanjiAgent();
    const result = await sanji.execute(
      createTask('implement a retryable queue', { files: ['src/index.ts', 'src/queue.ts'] })
    );

    expect(result.success).toBe(true);
    expect(SpecialistOutput.safeParse(result.result).success).toBe(true);

    const output = SpecialistOutput.parse(result.result);
    expect(output.specialist).toBe('sanji');
    expect(output.title).toBe('Implementation plan');
    expect(output.response).toContain('Sanji response');
    expect(output.prompt).toContain('coding specialist');
    expect(output.prompt).toContain('retryable queue');
    expect(output.warnings).toContain('Destructive or broad refactors require Ace approval before execution.');
  });
});
