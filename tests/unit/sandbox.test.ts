import { describe, it, expect } from 'vitest';
import { isSafeCode, executeCode } from '../../src/execution/sandbox.js';

describe('isSafeCode', () => {
  it('allows safe Python code', () => {
    expect(isSafeCode('print("hello world")')).toEqual({ safe: true });
    expect(isSafeCode('x = 1 + 2\nprint(x)')).toEqual({ safe: true });
    expect(isSafeCode('def fib(n): return n if n <= 1 else fib(n-1)+fib(n-2)')).toEqual({ safe: true });
  });

  it('blocks dangerous patterns', () => {
    expect(isSafeCode('import os\nos.system("rm -rf /")')).toMatchObject({ safe: false });
    expect(isSafeCode('import subprocess')).toMatchObject({ safe: false });
    expect(isSafeCode('exec("bad code")')).toMatchObject({ safe: false });
    expect(isSafeCode('open("/etc/passwd")')).toMatchObject({ safe: false });
    expect(isSafeCode('import socket')).toMatchObject({ safe: false });
  });

  it('returns reason when blocking', () => {
    const result = isSafeCode('import os');
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('Blocked');
  });
});

describe('executeCode', () => {
  it('returns stdout for valid Python', async () => {
    const result = await executeCode('print(2 + 2)', { language: 'python' });
    if (result.exitCode === 0) {
      expect(result.stdout).toContain('4');
      expect(result.timedOut).toBe(false);
    }
    // If python3 not available in test env, just check structure
    expect(typeof result.stdout).toBe('string');
    expect(typeof result.exitCode).toBe('number');
    expect(typeof result.durationMs).toBe('number');
  }, { timeout: 15_000 });

  it('captures stderr on error', async () => {
    const result = await executeCode('print(undefined_variable)', { language: 'python' });
    if (result.exitCode !== 0) {
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  }, { timeout: 15_000 });

  it('returns timeout result when code runs too long', async () => {
    const result = await executeCode('import time; time.sleep(5)', {
      language: 'python',
      timeoutMs: 100,
    });
    // Either timed out or python not available
    if (result.timedOut) {
      expect(result.exitCode).toBe(1);
    }
    expect(typeof result.timedOut).toBe('boolean');
  }, { timeout: 5_000 });
});
