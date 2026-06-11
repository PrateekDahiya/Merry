import { ContextResponse } from '../types/messages.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'github-search' });

export interface GitHubSearchOptions {
  token: string;
  username: string;
  maxResults?: number;
}

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string | null;
  language: string | null;
  html_url: string;
  default_branch: string;
}

interface GitHubCodeItem {
  path: string;
  repository: { full_name: string };
  text_matches?: Array<{ fragment: string }>;
}

/**
 * Two-phase GitHub context search:
 *
 *  Phase 1 — Repo discovery
 *    Search repos by name/description. If none match, list the user's most
 *    recently updated repos as candidates.
 *
 *  Phase 2 — Content retrieval
 *    For each found repo: fetch README (explains how the project works).
 *    Then do a focused code search within those repos for technical terms.
 *
 * This is far more useful than a global code search because READMEs describe
 * architecture and features in human language, which is what questions like
 * "how does X work?" actually need.
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
    const terms = extractTerms(query);
    if (terms.length === 0) return empty(taskId, 'Query has no searchable terms.');

    const findings: ContextResponse['findings'] = [];

    try {
      // Phase 1: find relevant repos
      const repos = await this.findRepos(terms);

      if (repos.length === 0) {
        logger.info({ taskId, terms }, 'GitHub: no matching repos found');
        return empty(taskId, `No GitHub repositories matched "${terms.slice(0, 3).join(', ')}" for @${this.username}.`);
      }

      logger.info({ taskId, repos: repos.map(r => r.full_name) }, 'GitHub: repos found');

      // Phase 2: README + code per repo (in parallel)
      const repoResults = await Promise.allSettled(
        repos.slice(0, 3).map(repo => this.fetchRepoContext(repo, terms))
      );

      for (const r of repoResults) {
        if (r.status === 'fulfilled') findings.push(...r.value);
      }

    } catch (err) {
      logger.warn({ err: String(err) }, 'GitHub search error');
      return empty(taskId, `GitHub search failed: ${String(err)}`);
    }

    const sorted = findings
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, this.maxResults);

    const summary = sorted.length > 0
      ? `Found ${sorted.length} GitHub context item(s) for @${this.username}.`
      : `No relevant content found in GitHub repos for @${this.username}.`;

    logger.info({ taskId, count: sorted.length }, 'GitHub search completed');
    return { taskId, findings: sorted, summary, timestamp: new Date() };
  }

  private async findRepos(terms: string[]): Promise<GitHubRepo[]> {
    // Always list all repos so we can score them locally.
    // GitHub's search API misses repos when query terms don't exactly match
    // the repo name/description (e.g. "youtube clone" vs repo named "yt-clone").
    const [allRepos, searchRepos] = await Promise.allSettled([
      this.get<GitHubRepo[]>(
        `https://api.github.com/user/repos?per_page=100&sort=pushed&type=owner&affiliation=owner`,
        false
      ),
      this.get<{ items: GitHubRepo[] }>(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(terms.slice(0, 4).join('+'))}+user:${this.username}&per_page=5`,
        false
      ).then(r => r.items),
    ]);

    const combined = new Map<string, GitHubRepo>();

    if (allRepos.status === 'fulfilled') {
      for (const r of allRepos.value) combined.set(r.full_name, r);
    }
    if (searchRepos.status === 'fulfilled') {
      for (const r of searchRepos.value) combined.set(r.full_name, r);
    }

    if (combined.size === 0) return [];

    // Score every repo by how well its name + description match the query terms
    const scored = Array.from(combined.values())
      .map(repo => ({ repo, score: scoreRepo(repo, terms) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    // Return top 3 matches, or if nothing scored, the 3 most recently pushed
    if (scored.length > 0) {
      return scored.slice(0, 3).map(s => s.repo);
    }

    return Array.from(combined.values()).slice(0, 3);
  }

  private async fetchRepoContext(
    repo: GitHubRepo,
    terms: string[],
  ): Promise<ContextResponse['findings']> {
    const findings: ContextResponse['findings'] = [];

    // Always include repo metadata as a finding
    findings.push({
      source: `github:${repo.full_name}`,
      snippet: [
        `Repository: ${repo.full_name}`,
        repo.description ? `Description: ${repo.description}` : null,
        repo.language ? `Language: ${repo.language}` : null,
        `URL: ${repo.html_url}`,
      ].filter(Boolean).join('\n'),
      relevance: 0.5,
    });

    // Fetch README in parallel with code search
    const [readmeResult, codeResult] = await Promise.allSettled([
      this.fetchReadme(repo),
      this.searchCodeInRepo(repo, terms),
    ]);

    if (readmeResult.status === 'fulfilled' && readmeResult.value) {
      findings.push({
        source: `github:${repo.full_name}/README.md`,
        snippet: readmeResult.value.substring(0, 1200),
        relevance: 0.9,
      });
    }

    if (codeResult.status === 'fulfilled') {
      findings.push(...codeResult.value);
    }

    return findings;
  }

  private async fetchReadme(repo: GitHubRepo): Promise<string | null> {
    try {
      const data = await this.get<{ content: string; encoding: string }>(
        `https://api.github.com/repos/${repo.full_name}/readme`,
        false
      );

      if (data.encoding === 'base64') {
        const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
        // Strip markdown images and links to keep it clean
        return decoded
          .replace(/!\[.*?\]\(.*?\)/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .substring(0, 2000);
      }
    } catch {
      // Repo has no README — that's fine
    }
    return null;
  }

  private async searchCodeInRepo(
    repo: GitHubRepo,
    terms: string[],
  ): Promise<ContextResponse['findings']> {
    const codeTerms = terms.filter(t => t.length > 3).slice(0, 3);
    if (codeTerms.length === 0) return [];

    const q = `${codeTerms.join('+')}+repo:${repo.full_name}`;
    try {
      const res = await this.get<{ items: GitHubCodeItem[] }>(
        `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=3`,
        true
      );

      return res.items.map(item => ({
        source: `github:${item.repository.full_name}/${item.path}`,
        snippet: item.text_matches?.[0]?.fragment?.substring(0, 600)
          ?? `File: ${item.path}`,
        relevance: item.text_matches?.length ? 0.8 : 0.4,
      }));
    } catch {
      return [];
    }
  }

  private async get<T>(url: string, textMatch: boolean): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Accept': textMatch
          ? 'application/vnd.github.text-match+json'
          : 'application/vnd.github+json',
      },
    });

    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        throw new Error(`GitHub rate limit hit. Resets at ${reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown'}`);
      }
      throw new Error('GitHub API 403 — check your token has repo read scope');
    }

    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    }

    return res.json() as Promise<T>;
  }
}

function scoreRepo(repo: GitHubRepo, terms: string[]): number {
  // Normalise name: "youtube-clone" → "youtube clone", "yt_clone" → "yt clone"
  const name = repo.name.toLowerCase().replace(/[-_]/g, ' ');
  const desc = (repo.description ?? '').toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (name.includes(term)) score += 3;       // name match is strongest signal
    else if (name.split(' ').some(w => w.startsWith(term))) score += 2;
    if (desc.includes(term)) score += 1;
  }

  // Bonus: common abbreviations (yt → youtube, vid → video)
  const aliases: Record<string, string[]> = {
    youtube: ['yt', 'ytube'],
    video: ['vid', 'vids'],
    clone: ['copy', 'replica'],
    recommendation: ['rec', 'recs', 'recommend'],
  };
  for (const term of terms) {
    for (const [canonical, abbrevs] of Object.entries(aliases)) {
      if (term === canonical || abbrevs.includes(term)) {
        const checks = [canonical, ...abbrevs];
        if (checks.some(c => name.includes(c))) score += 2;
      }
    }
  }

  return score;
}

function extractTerms(query: string): string[] {
  const stop = new Set(['a','an','the','is','in','on','for','to','and','or','how',
    'what','can','i','my','me','please','tell','get','does','make','making','its',
    'will','was','has','have','are','be','do','did','your','our','their','this',
    'that','with','from','about','when','where','why','who']);

  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !stop.has(t))
    .slice(0, 6);
}

function empty(taskId: string, summary: string): ContextResponse {
  return { taskId, findings: [], summary, timestamp: new Date() };
}
