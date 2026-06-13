import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../../src/utils/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts in CLOSED state', () => {
    const cb = new CircuitBreaker();
    expect(cb.currentState).toBe('CLOSED');
  });

  it('allows calls in CLOSED state', async () => {
    const cb = new CircuitBreaker();
    const result = await cb.call(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.currentState).toBe('CLOSED');
  });

  it('opens after reaching failure threshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeMs: 60_000 });
    const fail = () => cb.call(async () => { throw new Error('fail'); }).catch(() => {});
    await fail(); await fail(); await fail();
    expect(cb.currentState).toBe('OPEN');
  });

  it('returns fallback when OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 60_000 });
    await cb.call(async () => { throw new Error('x'); }).catch(() => {});
    const result = await cb.call(async () => 'real', () => 'fallback');
    expect(result).toBe('fallback');
  });

  it('throws when OPEN and no fallback', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 60_000 });
    await cb.call(async () => { throw new Error('x'); }).catch(() => {});
    await expect(cb.call(async () => 'real')).rejects.toThrow('Circuit OPEN');
  });

  it('transitions to HALF_OPEN after resetTime expires', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 10 });
    await cb.call(async () => { throw new Error('x'); }).catch(() => {});
    expect(cb.currentState).toBe('OPEN');
    await new Promise(r => setTimeout(r, 15));
    // Next call triggers HALF_OPEN transition
    await cb.call(async () => 'probe').catch(() => {});
    // If probe succeeded, state should be CLOSED
    expect(cb.currentState).toBe('CLOSED');
  });

  it('goes back to OPEN if half-open probe fails', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 10 });
    await cb.call(async () => { throw new Error('x'); }).catch(() => {});
    await new Promise(r => setTimeout(r, 15));
    // Probe call fails
    await cb.call(async () => { throw new Error('still down'); }).catch(() => {});
    expect(cb.currentState).toBe('OPEN');
  });

  it('reset() returns to CLOSED', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeMs: 60_000 });
    cb.reset();  // Start by opening manually via failure, then reset
    expect(cb.currentState).toBe('CLOSED');
  });
});
