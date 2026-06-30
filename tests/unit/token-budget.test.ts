import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  truncateToTokens,
  compressChain,
  ChainEntry,
} from '../../src/utils/token-budget.js';

/** Create a string of exactly `n` tokens (n * 4 chars at 4 chars/token). */
function tokens(n: number): string {
  return 'a'.repeat(n * 4);
}

// ── estimateTokens ────────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 1 for exactly 4 chars', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('rounds up for partial tokens', () => {
    expect(estimateTokens('abc')).toBe(1);   // 3/4 → ceil → 1
    expect(estimateTokens('abcde')).toBe(2); // 5/4 → ceil → 2
  });

  it('scales linearly with text length', () => {
    expect(estimateTokens(tokens(100))).toBe(100);
    expect(estimateTokens(tokens(5000))).toBe(5000);
  });
});

// ── truncateToTokens ──────────────────────────────────────────────────────────

describe('truncateToTokens', () => {
  it('returns unchanged text when under the limit', () => {
    const text = 'hello world';
    expect(truncateToTokens(text, 100)).toBe(text);
  });

  it('truncates and appends "..." when over the limit', () => {
    const text = tokens(100);
    const result = truncateToTokens(text, 50);
    expect(result.endsWith('...')).toBe(true);
    expect(estimateTokens(result)).toBeLessThanOrEqual(50);
  });

  it('respects the exact token limit', () => {
    const text = tokens(1000);
    const result = truncateToTokens(text, 200);
    expect(estimateTokens(result)).toBeLessThanOrEqual(200);
  });

  it('keeps exact-limit text unchanged', () => {
    const text = tokens(50);
    expect(truncateToTokens(text, 50)).toBe(text);
  });
});

// ── compressChain ─────────────────────────────────────────────────────────────

describe('compressChain', () => {
  const BUDGET = 3_000; // small budget keeps test data fast

  it('returns chain unchanged when under budget', () => {
    const chain: ChainEntry[] = [
      { agent: 'user', content: 'Hello there' },
    ];
    expect(compressChain(chain, BUDGET)).toEqual(chain);
  });

  it('returns empty array for empty input', () => {
    expect(compressChain([], BUDGET)).toEqual([]);
  });

  it('drops [ace] routing note first when it causes overflow', () => {
    const chain: ChainEntry[] = [
      { agent: 'user', content: 'Hello' },
      { agent: 'ace', content: tokens(4000) },
    ];
    const result = compressChain(chain, BUDGET);
    expect(result.every(e => e.agent !== 'ace')).toBe(true);
    expect(result.some(e => e.agent === 'user')).toBe(true);
  });

  it('truncates [user profile] to 300 tokens before dropping history', () => {
    const chain: ChainEntry[] = [
      { agent: 'user profile', content: tokens(3500) },
      { agent: 'user', content: 'question?' },
    ];
    const result = compressChain(chain, BUDGET);
    const profile = result.find(e => e.agent === 'user profile');
    expect(profile).toBeDefined();
    expect(estimateTokens(profile!.content)).toBeLessThanOrEqual(300);
  });

  it('drops oldest [prev user] / [prev assistant] entries first', () => {
    const chain: ChainEntry[] = [
      { agent: 'prev user',      content: 'oldest question' },
      { agent: 'prev assistant', content: tokens(3500) },
      { agent: 'user',           content: 'new question' },
    ];
    const result = compressChain(chain, BUDGET);
    expect(result.some(e => e.agent === 'user')).toBe(true);
    const text = result.map(e => `[${e.agent}]: ${e.content}`).join('\n\n');
    expect(estimateTokens(text)).toBeLessThanOrEqual(BUDGET);
  });

  it('truncates [nami context] when no history is left to drop', () => {
    const chain: ChainEntry[] = [
      { agent: 'user',         content: 'how do fish breathe?' },
      { agent: 'nami context', content: tokens(4000) },
    ];
    const result = compressChain(chain, BUDGET);
    // nami context should survive (truncated, not removed)
    expect(result.some(e => e.agent === 'nami context')).toBe(true);
    const text = result.map(e => `[${e.agent}]: ${e.content}`).join('\n\n');
    expect(estimateTokens(text)).toBeLessThanOrEqual(BUDGET);
  });

  it('never drops the current [user] request', () => {
    const userContent = 'How do I implement quicksort?';
    const chain: ChainEntry[] = [
      { agent: 'user',         content: userContent },
      { agent: 'nami context', content: tokens(50_000) },
    ];
    const result = compressChain(chain, BUDGET);
    expect(result.find(e => e.agent === 'user')?.content).toBe(userContent);
  });

  it('total chain fits within budget after full compression', () => {
    const chain: ChainEntry[] = [
      { agent: 'user profile',   content: tokens(1000) },
      { agent: 'prev user',      content: tokens(1000) },
      { agent: 'prev assistant', content: tokens(1000) },
      { agent: 'user',           content: tokens(200) },
      { agent: 'ace',            content: tokens(100) },
      { agent: 'nami context',   content: tokens(2000) },
    ];
    const result = compressChain(chain, BUDGET);
    const text = result.map(e => `[${e.agent}]: ${e.content}`).join('\n\n');
    expect(estimateTokens(text)).toBeLessThanOrEqual(BUDGET);
  });

  it('compresses with default 12k budget for realistic chain sizes', () => {
    const chain: ChainEntry[] = [
      { agent: 'prev user',      content: tokens(3000) },
      { agent: 'prev assistant', content: tokens(3000) },
      { agent: 'prev user',      content: tokens(3000) },
      { agent: 'prev assistant', content: tokens(3000) },
      { agent: 'user',           content: 'What is the best sorting algorithm?' },
      { agent: 'nami context',   content: tokens(4000) },
    ];
    // total ≈ 16000 tokens > default 12k budget
    const result = compressChain(chain); // uses default MESSAGES_TOKEN_BUDGET
    const text = result.map(e => `[${e.agent}]: ${e.content}`).join('\n\n');
    expect(estimateTokens(text)).toBeLessThanOrEqual(12_000);
    // user request must always survive intact
    expect(result.find(e => e.agent === 'user')?.content).toBe('What is the best sorting algorithm?');
  });
});
