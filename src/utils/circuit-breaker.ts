/**
 * Circuit breaker pattern for external API calls.
 * Prevents cascading failures when LLM, GitHub, Wikipedia, etc. go down.
 *
 * States:
 *   CLOSED     — normal operation, all calls pass through
 *   OPEN       — after N failures, all calls return fallback for resetTimeMs
 *   HALF_OPEN  — one probe call allowed; success → CLOSED, failure → OPEN
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number;   // failures before opening (default 5)
  resetTimeMs?: number;        // ms to wait before half-open (default 30s)
  name?: string;               // for logging
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private nextAttempt = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeMs: number;
  readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeMs = options.resetTimeMs ?? 30_000;
    this.name = options.name ?? 'circuit';
  }

  get currentState(): CircuitState {
    return this.state;
  }

  /**
   * Execute fn through the circuit breaker.
   * If the circuit is OPEN and no fallback provided, throws an error.
   * If fallback is provided, returns it when OPEN.
   */
  async call<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        if (fallback) return fallback();
        throw new Error(`[${this.name}] Circuit OPEN — service unavailable. Retrying after ${Math.ceil((this.nextAttempt - Date.now()) / 1000)}s`);
      }
      // Window expired — allow one probe
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.resetTimeMs;
    }
  }

  /** Manually reset to CLOSED (useful in tests or after fixing the service). */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.nextAttempt = 0;
  }
}

/**
 * Pre-built circuit breakers for each external service.
 * Import these and wrap API calls with: await groqBreaker.call(() => ...)
 */
export const groqBreaker      = new CircuitBreaker({ name: 'groq',      failureThreshold: 5, resetTimeMs: 30_000 });
export const anthropicBreaker = new CircuitBreaker({ name: 'anthropic', failureThreshold: 5, resetTimeMs: 30_000 });
export const ollamaBreaker    = new CircuitBreaker({ name: 'ollama',    failureThreshold: 3, resetTimeMs: 15_000 });
export const githubBreaker    = new CircuitBreaker({ name: 'github',    failureThreshold: 5, resetTimeMs: 60_000 });
export const wikiBreaker      = new CircuitBreaker({ name: 'wikipedia', failureThreshold: 3, resetTimeMs: 30_000 });
export const ddgBreaker       = new CircuitBreaker({ name: 'duckduckgo',failureThreshold: 3, resetTimeMs: 30_000 });

/** Reset all singleton breakers to CLOSED — call in test afterEach/afterAll. */
export function resetAllBreakers(): void {
  groqBreaker.reset();
  anthropicBreaker.reset();
  ollamaBreaker.reset();
  githubBreaker.reset();
  wikiBreaker.reset();
  ddgBreaker.reset();
}
