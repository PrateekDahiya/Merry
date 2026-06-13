import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry, AgentPlugin } from '../../src/agents/registry.js';
import { BaseAgent } from '../../src/agents/base.js';
import { TaskEnvelope } from '../../src/types/messages.js';

class DummyAgent extends BaseAgent {
  constructor(readonly name: string) { super(`${name}-primary`, name); }
  protected async doWork(_task: TaskEnvelope): Promise<unknown> { return { agent: this.name }; }
}

const makePlugin = (type: string, matchKeyword?: string): AgentPlugin => ({
  type,
  description: `${type} agent`,
  emoji: '🔧',
  matches: matchKeyword ? (r) => r.toLowerCase().includes(matchKeyword) : undefined,
  factory: () => new DummyAgent(type),
});

describe('AgentRegistry (isolated instance)', () => {
  let reg: AgentRegistry;

  beforeEach(() => {
    // Import AgentRegistry class directly for isolated tests
    reg = new (class extends AgentRegistry {})();
    // Dynamically create isolated registry
    reg = Object.create(AgentRegistry.prototype) as AgentRegistry;
    (reg as any).plugins = new Map();
  });

  it('registers a plugin', () => {
    reg.register(makePlugin('test-agent'));
    expect(reg.has('test-agent')).toBe(true);
    expect(reg.getAll()).toHaveLength(1);
  });

  it('get() returns the registered plugin', () => {
    reg.register(makePlugin('writer'));
    const p = reg.get('writer');
    expect(p?.type).toBe('writer');
    expect(p?.emoji).toBe('🔧');
  });

  it('duplicate registration is silently ignored', () => {
    reg.register(makePlugin('dup'));
    reg.register(makePlugin('dup'));
    expect(reg.getAll()).toHaveLength(1);
  });

  it('factory creates a working agent', async () => {
    reg.register(makePlugin('worker'));
    const plugin = reg.get('worker')!;
    const agent = plugin.factory();
    const result = await agent.execute({
      taskId: 'task-1',
      chatId: '1',
      userId: '1',
      messageId: '1',
      timestamp: new Date(),
      state: 'running',
      userRequest: 'test',
    });
    expect(result.success).toBe(true);
  });

  it('findMatches returns plugins whose matches() returns true', () => {
    reg.register(makePlugin('coder', 'python'));
    reg.register(makePlugin('writer'));  // no matches function
    const matches = reg.findMatches('write python code');
    expect(matches.some(p => p.type === 'coder')).toBe(true);
  });

  it('clear() empties the registry', () => {
    reg.register(makePlugin('a'));
    reg.register(makePlugin('b'));
    reg.clear();
    expect(reg.getAll()).toHaveLength(0);
  });
});

describe('Global registry built-in registrations', () => {
  it('robin is registered', async () => {
    const { registry } = await import('../../src/agents/registry.js');
    expect(registry.has('robin')).toBe(true);
    expect(registry.get('robin')?.emoji).toBe('📖');
  });

  it('sanji is registered', async () => {
    const { registry } = await import('../../src/agents/registry.js');
    expect(registry.has('sanji')).toBe(true);
  });

  it('sanji matches coding keywords', async () => {
    const { registry } = await import('../../src/agents/registry.js');
    const sanji = registry.get('sanji')!;
    expect(sanji.matches?.('write python code')).toBe(true);
    expect(sanji.matches?.('debug this typescript error')).toBe(true);
    expect(sanji.matches?.('write a poem')).toBe(false);
  });
});
