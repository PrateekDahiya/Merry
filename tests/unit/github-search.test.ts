import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GitHubContextSearch } from '../../src/context/github-search.js';

const OK = (body: unknown) => Promise.resolve({
  ok: true, status: 200,
  headers: new Headers({ 'x-ratelimit-remaining': '29' }),
  json: async () => body,
  text: async () => '',
});

const FAIL = (status: number) => Promise.resolve({
  ok: false, status,
  headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' }),
  json: async () => ({}),
  text: async () => `error ${status}`,
});

const makeRepo = (name: string, description = '') => ({
  full_name: `testuser/${name}`, name,
  description, language: 'TypeScript',
  html_url: `https://github.com/testuser/${name}`,
  default_branch: 'main',
});

describe('GitHubContextSearch', () => {
  const options = { token: 'ghp_test', username: 'testuser', maxResults: 5 };

  beforeEach(() => { vi.restoreAllMocks(); });

  it('scores repos by name match and picks the best one', async () => {
    // findRepos makes 2 parallel calls: list-all-repos + search-repos
    // then per-repo: readme + code search
    vi.stubGlobal('fetch', vi.fn()
      // list all repos (contains youtube-clone + unrelated repos)
      .mockResolvedValueOnce(OK([
        makeRepo('my-portfolio', 'Portfolio site'),
        makeRepo('youtube-clone', 'A YouTube clone with personalized feed'),
        makeRepo('todo-app', 'Simple todo app'),
      ]))
      // repo search (may return empty or overlap)
      .mockResolvedValueOnce(OK({ items: [makeRepo('youtube-clone', 'A YouTube clone')] }))
      // readme for youtube-clone
      .mockResolvedValueOnce(OK({ content: btoa('# YouTube Clone\nPersonalized feed using collaborative filtering.'), encoding: 'base64' }))
      // code search within youtube-clone
      .mockResolvedValueOnce(OK({ items: [{ path: 'src/feed.ts', repository: { full_name: 'testuser/youtube-clone' }, text_matches: [{ fragment: 'getPersonalizedFeed()' }] }] }))
    );

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-1', 'youtube clone personalized feed');

    expect(result.findings.some(f => f.source.includes('youtube-clone'))).toBe(true);
    expect(result.findings.some(f => f.snippet.includes('YouTube Clone') || f.snippet.includes('collaborative'))).toBe(true);
  });

  it('matches abbreviated names (yt → youtube)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(OK([makeRepo('yt-clone', 'YouTube-like video platform')]))
      .mockResolvedValueOnce(OK({ items: [] }))
      .mockResolvedValueOnce(OK({ content: btoa('# YT Clone\nVideo feed algorithm.'), encoding: 'base64' }))
      .mockResolvedValueOnce(OK({ items: [] }))
    );

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-2', 'youtube clone feed');

    expect(result.findings.some(f => f.source.includes('yt-clone'))).toBe(true);
  });

  it('falls back to most recent repos when nothing scores', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(OK([makeRepo('random-project', 'Something unrelated')]))
      .mockResolvedValueOnce(OK({ items: [] }))
      .mockResolvedValueOnce(FAIL(404))   // no readme
      .mockResolvedValueOnce(OK({ items: [] }))
    );

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-3', 'something completely different');

    // Should still return the repo metadata as fallback
    expect(result.findings.some(f => f.source.includes('random-project'))).toBe(true);
  });

  it('degrades gracefully on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(FAIL(403)));

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-4', 'anything');

    expect(result.findings).toHaveLength(0);
  });

  it('skips fetch entirely when query has no useful terms', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const search = new GitHubContextSearch(options);
    const result = await search.search('task-5', 'in the');

    expect(result.findings).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('caps findings at maxResults', async () => {
    const manyRepos = Array.from({ length: 10 }, (_, i) => makeRepo(`repo-${i}`, `youtube project ${i}`));

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(OK(manyRepos))
      .mockResolvedValueOnce(OK({ items: [] }))
      .mockResolvedValue(OK({ content: btoa('readme'), encoding: 'base64' }))
    );

    const search = new GitHubContextSearch({ ...options, maxResults: 3 });
    const result = await search.search('task-6', 'youtube video platform');

    expect(result.findings.length).toBeLessThanOrEqual(3);
  });
});
