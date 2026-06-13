import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter } from '../../src/middleware/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(3, 60_000);  // 3 req per minute for fast tests
  });

  it('allows requests up to the limit', () => {
    expect(limiter.allow('chat-1')).toBe(true);
    expect(limiter.allow('chat-1')).toBe(true);
    expect(limiter.allow('chat-1')).toBe(true);
  });

  it('blocks requests over the limit', () => {
    limiter.allow('chat-1');
    limiter.allow('chat-1');
    limiter.allow('chat-1');
    expect(limiter.allow('chat-1')).toBe(false);
  });

  it('different chatIds have independent buckets', () => {
    limiter.allow('chat-a');
    limiter.allow('chat-a');
    limiter.allow('chat-a');
    // chat-a is exhausted but chat-b is fresh
    expect(limiter.allow('chat-a')).toBe(false);
    expect(limiter.allow('chat-b')).toBe(true);
  });

  it('resets after window expires', () => {
    const fastLimiter = new RateLimiter(1, 10);  // 1 req per 10ms
    fastLimiter.allow('chat-1');
    expect(fastLimiter.allow('chat-1')).toBe(false);

    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(fastLimiter.allow('chat-1')).toBe(true);
        resolve();
      }, 15);
    });
  });

  it('retryAfterSeconds returns positive value when limited', () => {
    limiter.allow('chat-1');
    limiter.allow('chat-1');
    limiter.allow('chat-1');
    limiter.allow('chat-1');  // blocked
    expect(limiter.retryAfterSeconds('chat-1')).toBeGreaterThan(0);
  });

  it('retryAfterSeconds returns 0 for fresh chatId', () => {
    expect(limiter.retryAfterSeconds('never-seen')).toBe(0);
  });

  it('reset() clears all buckets', () => {
    limiter.allow('chat-1');
    limiter.allow('chat-1');
    limiter.allow('chat-1');
    limiter.reset();
    expect(limiter.allow('chat-1')).toBe(true);
  });
});
