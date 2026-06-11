import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NamiAgent } from '../../src/agents/nami.js';
import { RepositoryContextSearch } from '../../src/context/repository-search.js';
import { TaskEnvelope } from '../../src/types/messages.js';

let tempRoot: string;

function createTask(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    taskId: 'task-context',
    chatId: 'chat-1',
    userId: 'user-1',
    messageId: 'msg-1',
    timestamp: new Date('2026-06-11T00:00:00.000Z'),
    state: 'waiting_for_context',
    userRequest: 'Find config validation and telegram routing',
    assignedAgent: 'nami',
    ...overrides,
  };
}

describe('RepositoryContextSearch', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'merry-context-'));
    await mkdir(path.join(tempRoot, 'src', 'config'), { recursive: true });
    await mkdir(path.join(tempRoot, 'src', 'telegram'), { recursive: true });
    await mkdir(path.join(tempRoot, 'node_modules', 'ignored'), { recursive: true });

    await writeFile(
      path.join(tempRoot, 'src', 'config', 'config.ts'),
      'export function loadConfig() { return "config validation for telegram routing"; }'
    );
    await writeFile(
      path.join(tempRoot, 'src', 'telegram', 'adapter.ts'),
      'export const routeTelegramMessage = "telegram routing adapter";'
    );
    await writeFile(
      path.join(tempRoot, 'node_modules', 'ignored', 'config.ts'),
      'config validation should not be included from ignored dependencies'
    );
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('returns ranked context findings with snippets and relative source paths', async () => {
    const search = new RepositoryContextSearch({ rootDir: tempRoot, maxResults: 5 });
    const response = await search.search('task-context', 'telegram config validation');

    expect(response.taskId).toBe('task-context');
    expect(response.findings.length).toBeGreaterThan(0);
    expect(response.findings[0].source).toBe(path.join('src', 'config', 'config.ts'));
    expect(response.findings[0].snippet).toContain('config validation');
    expect(response.findings[0].relevance).toBeGreaterThan(0);
    expect(response.findings.some(finding => finding.source.includes('node_modules'))).toBe(false);
  });

  it('returns an empty result set when no terms match', async () => {
    const search = new RepositoryContextSearch({ rootDir: tempRoot });
    const response = await search.search('task-context', 'unrelated database migration');

    expect(response.findings).toEqual([]);
    expect(response.summary).toContain('No local context matched');
  });
});

describe('NamiAgent', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'merry-nami-'));
    await mkdir(path.join(tempRoot, 'docs'), { recursive: true });
    await writeFile(path.join(tempRoot, 'docs', 'telegram.md'), 'Telegram adapter setup and routing notes');
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('returns a structured context response from local search', async () => {
    const nami = new NamiAgent({ rootDir: tempRoot });
    const result = await nami.execute(createTask({ userRequest: 'telegram adapter setup' }));

    expect(result.success).toBe(true);
    expect(JSON.stringify(result.result)).toContain('docs');
    expect(JSON.stringify(result.result)).toContain('telegram.md');
  });
});
