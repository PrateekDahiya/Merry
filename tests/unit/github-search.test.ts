import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GitHubContextSearch } from '../../src/context/github-search.js';

function mockFetch(items: unknown[], status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    headers: new Headers({ 'x-ratelimit-remaining': '29' }),
    json: async () => ({ items }),
    text: async () => 'error body',
  });
}

describe('GitHubContextSearch', () => {
  const options = { token: 'ghp_test', username: 'testuser', maxResults: 3 };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns findings from code and repo search', async () => {
    const codeItems = [
      {
        path: 'src/app.ts',
        repository: { full_name: 'testuser/my-app', description: 'My app' },
        html_url: 'https://github.com/testuser/my-app/blob/main/src/app.ts',
        text_matches: [{ fragment: 'function handleRequest() {}', matches: [] }],
      },
    ];
    const repoItems = [
      {
        full_name: 'testuser/my-app',
        description: 'A web app for task management',
        language: 'TypeScript',
        html_url: 'https://github.com/testuser/my-app',
        stargazers_count: 10,
      },
    ];

    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
      const items = call++ === 0 ? codeItems : repoItems;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'x-ratelimit-remaining': '29' }),
        json: async () => ({ items }),
        text: async () => '',
      });
    }));

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-1', 'handle request TypeScript');

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some(f => f.source.includes('testuser/my-app'))).toBe(true);
    expect(result.summary).toContain('testuser');
  });

  it('degrades gracefully when GitHub API returns 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' }),
      text: async () => 'rate limited',
      json: async () => ({}),
    }));

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-2', 'anything');

    expect(result.findings).toHaveLength(0);
    expect(result.summary).toBeDefined();
  });

  it('returns empty findings when query has no useful terms', async () => {
    vi.stubGlobal('fetch', mockFetch([]));

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-3', 'in the');

    expect(result.findings).toHaveLength(0);
  });

  it('caps results at maxResults', async () => {
    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      path: `src/file${i}.ts`,
      repository: { full_name: 'testuser/big-repo', description: null },
      html_url: `https://github.com/testuser/big-repo/blob/main/src/file${i}.ts`,
      text_matches: [{ fragment: `snippet ${i}`, matches: [] }],
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-ratelimit-remaining': '29' }),
      json: async () => ({ items: manyItems }),
      text: async () => '',
    }));

    const search = new GitHubContextSearch({ ...options, maxResults: 3 });
    const result = await search.search('task-4', 'some code query here');

    expect(result.findings.length).toBeLessThanOrEqual(3);
  });
});
