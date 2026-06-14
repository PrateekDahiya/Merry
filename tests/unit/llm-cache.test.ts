import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cacheKey, getCachedResponse, setCachedResponse, clearCache, getCacheStats } from '../../src/llm/cache.js';
import { CachedLlmClient, MockLlmClient } from '../../src/llm/client.js';
import { groqBreaker, anthropicBreaker, ollamaBreaker } from '../../src/utils/circuit-breaker.js';
import type { LlmRequest } from '../../src/llm/client.js';

const req: LlmRequest = {
  system: 'You are a test assistant',
  messages: [{ role: 'user', content: 'What is 2+2?' }],
  maxTokens: 100,
};

describe('LLM cache', () => {
  beforeEach(() => clearCache());
  afterEach(() => { groqBreaker.reset(); anthropicBreaker.reset(); ollamaBreaker.reset(); });

  it('cacheKey is stable for the same request', () => {
    const k1 = cacheKey(req);
    const k2 = cacheKey(req);
    expect(k1).toBe(k2);
    expect(k1.length).toBeGreaterThan(8);
  });

  it('cacheKey differs for different requests', () => {
    const other: LlmRequest = { ...req, messages: [{ role: 'user', content: 'Different?' }] };
    expect(cacheKey(req)).not.toBe(cacheKey(other));
  });

  it('getCachedResponse returns null on miss', () => {
    expect(getCachedResponse(req)).toBeNull();
  });

  it('getCachedResponse returns entry after setCachedResponse', () => {
    setCachedResponse(req, { content: 'four', inputTokens: 10, outputTokens: 5 });
    const result = getCachedResponse(req);
    expect(result?.content).toBe('four');
    expect(result?.inputTokens).toBe(10);
  });

  it('clearCache empties the cache', () => {
    setCachedResponse(req, { content: 'x', inputTokens: 1, outputTokens: 1 });
    clearCache();
    expect(getCachedResponse(req)).toBeNull();
    expect(getCacheStats().size).toBe(0);
  });
});

describe('CachedLlmClient', () => {
  beforeEach(() => clearCache());

  it('calls inner client on first request', async () => {
    const inner = new MockLlmClient();
    const client = new CachedLlmClient(inner);
    const result = await client.chat(req);
    expect(result.content).toBeTruthy();
  });

  it('returns cached result on second identical request', async () => {
    let callCount = 0;
    const mockClient = {
      chat: async () => {
        callCount++;
        return { content: `call ${callCount}`, inputTokens: 1, outputTokens: 1 };
      },
    };
    const client = new CachedLlmClient(mockClient);

    const r1 = await client.chat(req);
    const r2 = await client.chat(req);
    expect(r1.content).toBe(r2.content);  // same result
    expect(callCount).toBe(1);             // inner called only once
  });

  it('bypasses cache for ultra-short routing calls (maxTokens <= 5)', async () => {
    let callCount = 0;
    const mockClient = {
      chat: async () => {
        callCount++;
        return { content: 'sanji', inputTokens: 1, outputTokens: 1 };
      },
    };
    const client = new CachedLlmClient(mockClient);
    const shortReq: LlmRequest = { ...req, maxTokens: 5 };

    await client.chat(shortReq);
    await client.chat(shortReq);
    expect(callCount).toBe(2);  // not cached
  });
});
