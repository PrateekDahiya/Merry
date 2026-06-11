import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GitHubContextSearch } from '../../src/context/github-search.js';

const OK = (body: unknown) => Promise.resolve({
  ok: true,
  status: 200,
  headers: new Headers({ 'x-ratelimit-remaining': '29' }),
  json: async () => body,
  text: async () => '',
});

const FAIL = (status: number, remaining = '0') => Promise.resolve({
  ok: false,
  status,
  headers: new Headers({ 'x-ratelimit-remaining': remaining, 'x-ratelimit-reset': '9999999999' }),
  json: async () => ({}),
  text: async () => `error ${status}`,
});

describe('GitHubContextSearch', () => {
  const options = { token: 'ghp_test', username: 'testuser', maxResults: 5 };

  beforeEach(() => { vi.restoreAllMocks(); });

  it('returns findings: repo metadata + README + code snippets', async () => {
    const repoItems = [{
      full_name: 'testuser/my-app', name: 'my-app',
      description: 'A web app for task management',
      language: 'TypeScript', html_url: 'https://github.com/testuser/my-app',
      default_branch: 'main',
    }];

    // Call order: repo search → readme → code search
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(OK({ items: repoItems }))               // repo search
      .mockResolvedValueOnce(OK({ content: btoa('# My App\nHandles requests.'), encoding: 'base64' })) // readme
      .mockResolvedValueOnce(OK({ items: [{ path: 'src/app.ts', repository: { full_name: 'testuser/my-app' }, text_matches: [{ fragment: 'handleRequest()' }] }] })) // code search
    );

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-1', 'handle request TypeScript');

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.some(f => f.source.includes('testuser/my-app'))).toBe(true);
    expect(result.summary).toContain('testuser');
  });

  it('falls back to listing repos when repo search returns empty', async () => {
    const listedRepos = [{
      full_name: 'testuser/other-project', name: 'other-project',
      description: 'Another project', language: 'Go',
      html_url: 'https://github.com/testuser/other-project', default_branch: 'main',
    }];

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(OK({ items: [] }))       // repo search → empty
      .mockResolvedValueOnce(OK(listedRepos))          // list repos fallback
      .mockResolvedValueOnce(FAIL(404))                // readme not found
      .mockResolvedValueOnce(OK({ items: [] }))        // code search
    );

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-2', 'deploy other project');

    expect(result.findings.some(f => f.source.includes('testuser/other-project'))).toBe(true);
  });

  it('degrades gracefully when GitHub API returns 403 rate-limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(FAIL(403)));

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-3', 'some query');

    expect(result.findings).toHaveLength(0);
    expect(result.summary).toBeDefined();
  });

  it('returns empty when query has no useful terms', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-4', 'in the');

    expect(result.findings).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('caps total findings at maxResults', async () => {
    const repos = Array.from({ length: 3 }, (_, i) => ({
      full_name: `testuser/repo${i}`, name: `repo${i}`,
      description: `Repo ${i}`, language: 'JS',
      html_url: `https://github.com/testuser/repo${i}`, default_branch: 'main',
    }));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(OK({ items: repos, content: btoa('readme'), encoding: 'base64' })));

    const search = new GitHubContextSearch({ ...options, maxResults: 2 });
    const result = await search.search('task-5', 'some longer query here please');

    expect(result.findings.length).toBeLessThanOrEqual(2);
  });
});
