import { describe, it, expect } from 'vitest';
import { decomposeTask, assembleMultiStepResult } from '../../src/orchestrator/planner.js';
import { MockLlmClient } from '../../src/llm/client.js';

describe('decomposeTask', () => {
  it('returns isComplex=false for simple requests via mock', async () => {
    // MockLlmClient returns writing/coding JSON, not a decompose plan
    // decomposeTask catches parse error and falls back to single-step
    const llm = new MockLlmClient();
    const result = await decomposeTask('write fibonacci', llm);
    // MockLlmClient returns SpecialistOutput JSON which won't parse as TaskPlan
    // Falls back to { subtasks: [], isComplex: false }
    expect(result.isComplex).toBe(false);
  });

  it('falls back gracefully when LLM returns unexpected JSON', async () => {
    const badLlm = {
      chat: async () => ({ content: 'not json at all', inputTokens: 1, outputTokens: 1 }),
    };
    const result = await decomposeTask('complex request', badLlm as any);
    expect(result.subtasks).toEqual([]);
    expect(result.isComplex).toBe(false);
  });

  it('parses valid decomposition JSON', async () => {
    const mockPlan = { subtasks: ['Write the code', 'Add tests', 'Write docs'], isComplex: true };
    const jsonLlm = {
      chat: async () => ({ content: JSON.stringify(mockPlan), inputTokens: 1, outputTokens: 1 }),
    };
    const result = await decomposeTask('build a REST API with auth and tests', jsonLlm as any);
    expect(result.isComplex).toBe(true);
    expect(result.subtasks).toHaveLength(3);
    expect(result.subtasks[0]).toBe('Write the code');
  });

  it('caps subtasks at 3', async () => {
    const bigPlan = {
      subtasks: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      isComplex: true,
    };
    const bigLlm = {
      chat: async () => ({ content: JSON.stringify(bigPlan), inputTokens: 1, outputTokens: 1 }),
    };
    const result = await decomposeTask('very complex request', bigLlm as any);
    expect(result.subtasks.length).toBeLessThanOrEqual(3);
  });
});

describe('assembleMultiStepResult', () => {
  it('returns single result unchanged', () => {
    const result = assembleMultiStepResult(['Write code'], ['def fib(n): return n']);
    expect(result).toBe('def fib(n): return n');
  });

  it('assembles multiple steps with headers', () => {
    const result = assembleMultiStepResult(
      ['Write the code', 'Write the tests'],
      ['def fib(n): ...', 'def test_fib(): ...']
    );
    expect(result).toContain('### Write the code');
    expect(result).toContain('### Write the tests');
    expect(result).toContain('def fib');
    expect(result).toContain('def test_fib');
  });

  it('returns empty string for empty results', () => {
    expect(assembleMultiStepResult([], [])).toBe('');
  });
});
