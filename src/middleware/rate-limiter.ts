/**
 * In-memory per-chatId rate limiter.
 * Default: 10 requests per minute. Resets after the window expires.
 * No external service required.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 10, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * Returns true if the request should be allowed, false if rate-limited.
   * Automatically resets the bucket when the window expires.
   */
  allow(chatId: string): boolean {
    const now = Date.now();
    const key = String(chatId);
    const bucket = this.buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (bucket.count >= this.maxRequests) {
      return false;
    }

    bucket.count++;
    return true;
  }

  /** Returns how many seconds until the bucket resets for this chatId. */
  retryAfterSeconds(chatId: string): number {
    const bucket = this.buckets.get(String(chatId));
    if (!bucket) return 0;
    return Math.max(0, Math.ceil((bucket.resetAt - Date.now()) / 1000));
  }

  /** Clear all buckets (useful in tests). */
  reset(): void {
    this.buckets.clear();
  }
}

/** Singleton instance used by Jinbe. */
export const rateLimiter = new RateLimiter();
