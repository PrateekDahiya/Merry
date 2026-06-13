import { describe, it, expect, afterEach } from 'vitest';
import { taskTotal, llmDurationSeconds, registry } from '../../src/monitoring/metrics.js';
import { clearCache, getCacheStats } from '../../src/llm/cache.js';
import { stopMetricsServer } from '../../src/monitoring/metrics.js';

afterEach(() => {
  stopMetricsServer();
  clearCache();
});

describe('Prometheus metrics', () => {
  it('taskTotal counter is registered', () => {
    expect(taskTotal).toBeDefined();
    expect(typeof taskTotal.inc).toBe('function');
  });

  it('llmDurationSeconds histogram is registered', () => {
    expect(llmDurationSeconds).toBeDefined();
    expect(typeof llmDurationSeconds.observe).toBe('function');
  });

  it('registry exposes /metrics output as text', async () => {
    taskTotal.inc({ state: 'completed', agent: 'sanji' });
    const output = await registry.metrics();
    expect(output).toContain('merry_tasks_total');
    expect(typeof output).toBe('string');
  });

  it('histogram records observations', async () => {
    llmDurationSeconds.observe({ provider: 'groq', cached: 'false' }, 1.5);
    const output = await registry.metrics();
    expect(output).toContain('merry_llm_duration_seconds');
  });

  it('getCacheStats returns size and TTL', () => {
    const stats = getCacheStats();
    expect(typeof stats.size).toBe('number');
    expect(stats.maxSize).toBeGreaterThan(0);
    expect(stats.ttlMs).toBeGreaterThan(0);
  });
});
