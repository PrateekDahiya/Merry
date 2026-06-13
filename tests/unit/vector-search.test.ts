import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { VectorContextSearch } from '../../src/context/vector-search.js';

const testDir = join(tmpdir(), `merry-vector-${Date.now()}`);

describe('VectorContextSearch', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'auth.md'), '# Authentication\nJWT token validation middleware express');
    writeFileSync(join(testDir, 'database.md'), '# Database\nPostgreSQL SQL queries indexes transactions');
    writeFileSync(join(testDir, 'frontend.md'), '# Frontend\nReact hooks useState useEffect components');
    writeFileSync(join(testDir, 'python.md'), '# Python\nPython fibonacci recursion algorithm function');
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('builds index without error', async () => {
    const search = new VectorContextSearch({ rootDir: testDir });
    await expect(search.buildIndex()).resolves.not.toThrow();
  });

  it('returns empty findings before index is built', async () => {
    const search = new VectorContextSearch({ rootDir: testDir });
    const result = await search.search('task-1', 'JWT authentication');
    expect(result.findings).toHaveLength(0);
    expect(result.summary).toContain('not ready');
  });

  it('finds semantically relevant documents', async () => {
    const search = new VectorContextSearch({ rootDir: testDir, minScore: 0.001 });
    await search.buildIndex();
    const result = await search.search('task-2', 'JWT token authentication');
    expect(result.findings.length).toBeGreaterThan(0);
    // auth.md should rank highest for auth query
    const topSource = result.findings[0]?.source;
    expect(topSource).toContain('auth');
  });

  it('finds python-related content for fibonacci query', async () => {
    const search = new VectorContextSearch({ rootDir: testDir, minScore: 0.001 });
    await search.buildIndex();
    const result = await search.search('task-3', 'fibonacci python algorithm');
    const sources = result.findings.map(f => f.source);
    expect(sources.some(s => s.includes('python'))).toBe(true);
  });

  it('respects maxResults limit', async () => {
    const search = new VectorContextSearch({ rootDir: testDir, maxResults: 2, minScore: 0.001 });
    await search.buildIndex();
    const result = await search.search('task-4', 'code function');
    expect(result.findings.length).toBeLessThanOrEqual(2);
  });

  it('returns valid ContextResponse shape', async () => {
    const search = new VectorContextSearch({ rootDir: testDir, minScore: 0.001 });
    await search.buildIndex();
    const result = await search.search('task-5', 'database SQL');
    expect(result.taskId).toBe('task-5');
    expect(typeof result.summary).toBe('string');
    expect(result.timestamp).toBeInstanceOf(Date);
    for (const f of result.findings) {
      expect(typeof f.source).toBe('string');
      expect(typeof f.snippet).toBe('string');
      expect(f.relevance).toBeGreaterThanOrEqual(0);
      expect(f.relevance).toBeLessThanOrEqual(1);
    }
  });
});
