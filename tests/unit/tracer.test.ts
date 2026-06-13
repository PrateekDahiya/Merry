import { describe, it, expect } from 'vitest';
import { withSpan, getTracer } from '../../src/tracing/tracer.js';

describe('OpenTelemetry tracer', () => {
  it('getTracer() returns a tracer object', () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('withSpan() executes the wrapped function', async () => {
    let executed = false;
    await withSpan('test-span', async (_span) => {
      executed = true;
      return 'result';
    });
    expect(executed).toBe(true);
  });

  it('withSpan() returns the function result', async () => {
    const result = await withSpan('test-span-2', async () => 42);
    expect(result).toBe(42);
  });

  it('withSpan() propagates errors', async () => {
    await expect(
      withSpan('failing-span', async () => { throw new Error('test error'); })
    ).rejects.toThrow('test error');
  });

  it('withSpan() with attributes does not throw', async () => {
    await expect(
      withSpan('attributed-span', async () => 'ok', { agent: 'sanji', taskId: 'task-1' })
    ).resolves.toBe('ok');
  });
});
