import { createHash } from 'crypto';
import { LRUCache } from 'lru-cache';
import type { LlmRequest, LlmResponse } from './client.js';

const CACHE_MAX_ITEMS = 500;
const CACHE_TTL_MS = 5 * 60 * 1000;   // 5 minutes

interface CachedResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cachedAt: number;
}

const cache = new LRUCache<string, CachedResponse>({
  max: CACHE_MAX_ITEMS,
  ttl: CACHE_TTL_MS,
});

/**
 * Compute a stable cache key from the LLM request.
 * The key is a SHA-256 hash of the system prompt + messages JSON.
 */
export function cacheKey(request: LlmRequest): string {
  const payload = JSON.stringify({ system: request.system ?? '', messages: request.messages });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
}

/** Returns a cached response if available, or null on a miss. */
export function getCachedResponse(request: LlmRequest): LlmResponse | null {
  const entry = cache.get(cacheKey(request));
  if (!entry) return null;
  return {
    content: entry.content,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
  };
}

/** Store a response in the cache. */
export function setCachedResponse(request: LlmRequest, response: LlmResponse): void {
  cache.set(cacheKey(request), {
    content: response.content,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    cachedAt: Date.now(),
  });
}

/** Cache statistics for monitoring. */
export function getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return { size: cache.size, maxSize: CACHE_MAX_ITEMS, ttlMs: CACHE_TTL_MS };
}

/** Clear all cached entries (useful in tests). */
export function clearCache(): void {
  cache.clear();
}
