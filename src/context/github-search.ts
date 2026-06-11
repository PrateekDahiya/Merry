import { ContextResponse } from '../types/messages.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'github-search' });

export interface GitHubSearchOptions {
  token: string;
  username: string;
  maxResults?: number;
}

interface GitHubCodeItem {
  path: string;
  repository: { full_name: string; description: string | null };
  html_url: string;
  text_matches?: Array<{ fragment: string; matches: Array<{ text: string }> }>;
}

interface GitHubRepoItem {
  full_name: string;
  description: string | null;
  language: string | null;
  html_url: string;
  stargazers_count: number;
}

/**
 * Searches code and repositories across all of the user's GitHub repos.
 * Uses the GitHub REST Search API with text-match highlighting.
 * Degrades gracefully on rate-limit or auth errors — returns empty findings.
 */
export class GitHubContextSearch {
  private readonly token: string;
  private readonly username: string;
  private readonly maxResults: number;

  constructor(options: GitHubSearchOptions) {
    this.token = options.token;
    this.username = options.username;
    this.maxResults = options.maxResults ?? 5;
  }

  async search(taskId: string, query: string): Promise<ContextResponse> {
    const terms = extractSearchTerms(query);

    if (terms.length === 0) {
      return empty(taskId, 'No searchable terms in query.');
    }

    const [codeResult, repoResult] = await Promise.allSettled([
      this.searchCode(terms),
      this.searchRepos(terms),
    ]);

    const findings: ContextResponse['findings'] = [];

    if (repoResult.status === 'fulfilled') {
      for (const repo of repoResult.value) {
        if (repo.description) {
          findings.push({
            source: `github:${repo.full_name}`,
            snippet: `${repo.full_name}${repo.language ? ` [${repo.language}]` : ''}: ${repo.description}`,
            relevance: 0.6,
          });
        }
      }
    }

    if (codeResult.status === 'fulfilled') {
      for (const item of codeResult.value) {
        const fragment = item.text_matches?.[0]?.fragment;
        findings.push({
          source: `github:${item.repository.full_name}/${item.path}`,
          snippet: fragment
            ? fragment.substring(0, 500)
            : `${item.path} in ${item.repository.full_name}`,
          relevance: fragment ? 0.8 : 0.4,
        });
      }
    }

    if (codeResult.status === 'rejected') {
      logger.warn({ err: String(codeResult.reason) }, 'GitHub code search failed');
    }
    if (repoResult.status === 'rejected') {
      logger.warn({ err: String(repoResult.reason) }, 'GitHub repo search failed');
    }

    const sorted = findings
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, this.maxResults);

    const summary = sorted.length > 0
      ? `Found ${sorted.length} GitHub result(s) across @${this.username}'s repositories.`
      : `No relevant GitHub code found for @${this.username}.`;

    logger.info({ taskId, count: sorted.length }, 'GitHub search completed');

    return { taskId, findings: sorted, summary, timestamp: new Date() };
  }

  private async searchCode(terms: string[]): Promise<GitHubCodeItem[]> {
    const q = `${terms.join('+')}+user:${this.username}`;
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${this.maxResults}`;

    const res = await this.get<{ items: GitHubCodeItem[] }>(url, true);
    return res.items ?? [];
  }

  private async searchRepos(terms: string[]): Promise<GitHubRepoItem[]> {
    const q = `${terms.join('+')}+user:${this.username}`;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=5&sort=stars`;

    const res = await this.get<{ items: GitHubRepoItem[] }>(url, false);
    return res.items ?? [];
  }

  private async get<T>(url: string, textMatch: boolean): Promise<T> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Accept': textMatch
        ? 'application/vnd.github.text-match+json'
        : 'application/vnd.github+json',
    };

    const res = await fetch(url, { headers });

    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        throw new Error(`GitHub rate limit hit. Resets at ${reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown'}`);
      }
      throw new Error(`GitHub API 403 Forbidden — check your token has repo read scope`);
    }

    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    }

    return res.json() as Promise<T>;
  }
}

function extractSearchTerms(query: string): string[] {
  const stopWords = new Set(['a', 'an', 'the', 'is', 'in', 'on', 'for', 'to', 'and', 'or', 'how', 'what', 'can', 'i', 'my', 'me', 'please']);
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !stopWords.has(t))
    .slice(0, 6);
}

function empty(taskId: string, summary: string): ContextResponse {
  return { taskId, findings: [], summary, timestamp: new Date() };
}
