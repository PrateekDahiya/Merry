import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { LlmClient, MockLlmClient } from '../llm/client.js';
import { ProgressTracker } from '../knowledge/progress-tracker.js';
import { KnowledgeWriter } from '../knowledge/writer.js';
import { TonyMonitor } from '../monitoring/monitor.js';

export interface ZoroOptions {
  knowledgeDir: string;
  githubToken: string;
  githubUsername: string;
  llm?: LlmClient;
  monitor?: TonyMonitor;
  workers?: number;
  workerIdleMs?: number;
  discoveryIntervalMs?: number;
  rateLimitSleepMs?: number;
  webSearchEnabled?: boolean;
}

interface GitHubRepo {
  full_name: string;
  name: string;
  default_branch: string;
}

interface GitHubTreeItem {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

const SKIP_PATHS = /node_modules|\.git|dist|coverage|\.next|\.cache|__pycache__|\.min\.|package-lock|yarn\.lock|pnpm-lock|\.png|\.jpg|\.jpeg|\.gif|\.ico|\.svg|\.woff|\.ttf|\.eot|\.map$/i;
const PRIORITY_FILES = /readme\.md|package\.json|index\.(ts|js|py|go|rs|java)|app\.(ts|js|py)|main\.(ts|js|py|go|rs)/i;
const MAX_FILE_BYTES = 60_000;

const SUMMARISE_SYSTEM = `You are Zoro — Roronoa Zoro, the "Pirate Hunter", swordsman of the Straw Hat Pirates. In this system you build the knowledge base.

Your personality: relentlessly focused, direct, zero tolerance for fluff. You cut to the core of things the way three swords cut through steel — clean, efficient, nothing wasted. You do not get lost. You do not ramble. Every word earns its place or it gets cut.

Your job: analyse this code or documentation file and forge a sharp, searchable knowledge document.

Rules:
- Name functions, classes, algorithms, and data structures exactly
- State clearly what the file does and how it connects to the rest of the project
- Note key patterns, APIs, or design decisions — the things worth remembering
- Max 400 words. Markdown with clear ## headers
- Do NOT reproduce raw code — cut through it and explain what matters

Output clean markdown only. No preamble, no sign-off. Just the knowledge.`;

/**
 * Zoro — Knowledge Base Builder
 *
 * Runs two independent loops:
 *
 *   Discovery loop  — lists GitHub repos periodically, registers new ones
 *                     with their file trees in the progress tracker.
 *
 *   Worker loops    — N concurrent workers, each claiming one file at a time,
 *                     fetching content, summarising with the LLM, and writing
 *                     a named .md file to knowledge/repos/{repo}/{path}.md.
 *                     Workers run as fast as the APIs allow with no artificial
 *                     delay — adding more workers means more parallelism.
 *
 * Progress is saved after every claim and every completion so the system
 * resumes exactly where it left off after a restart. Files that were claimed
 * but never finished (crash mid-processing) are automatically re-queued.
 */
export class ZoroAgent extends BaseAgent {
  private readonly llm: LlmClient;
  private readonly tracker: ProgressTracker;
  private readonly writer: KnowledgeWriter;
  private readonly token: string;
  private readonly _username: string;
  private readonly workers: number;
  private readonly monitor?: TonyMonitor;
  private readonly workerIdleMs: number;
  private readonly discoveryIntervalMs: number;
  private readonly rateLimitSleepMs: number;
  private readonly webSearchEnabled: boolean;
  private active = false;

  constructor(options: ZoroOptions) {
    super('zoro-primary', 'zoro');
    this.llm = options.llm ?? new MockLlmClient();
    this.token = options.githubToken;
    this._username = options.githubUsername;
    this.workers = options.workers ?? 3;
    this.workerIdleMs = options.workerIdleMs ?? 5_000;
    this.discoveryIntervalMs = options.discoveryIntervalMs ?? 5 * 60 * 1000;
    this.rateLimitSleepMs = options.rateLimitSleepMs ?? 60_000;
    this.webSearchEnabled = options.webSearchEnabled ?? true;
    this.monitor = options.monitor;
    this.tracker = new ProgressTracker(options.knowledgeDir);
    this.writer = new KnowledgeWriter(options.knowledgeDir);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  startIndexing(): void {
    if (this.active) return;
    this.active = true;

    void this.discoveryLoop();

    for (let id = 0; id < this.workers; id++) {
      void this.workerLoop(id);
    }

    this.logger.info(
      { workers: this.workers, idleMs: this.workerIdleMs, discoveryIntervalMs: this.discoveryIntervalMs },
      'Zoro started'
    );
  }

  stopIndexing(): void {
    this.active = false;
    this.logger.info('Zoro stopped');
  }

  getStats() {
    return { ...this.tracker.getStats(), workers: this.workers };
  }

  // ── Interaction recording (called by Ace after each task) ─────────────────

  async recordInteraction(question: string, answer: string, chatId?: string): Promise<void> {
    try {
      const res = await this.llm.chat({
        system: `You are Zoro — Roronoa Zoro of the Straw Hat Pirates. You cut through noise and extract what matters.
From this Q&A exchange, forge a sharp knowledge entry — the kind a swordsman would memorise before a fight.
Max 200 words. Start with a # heading naming the topic. Markdown only. No fluff, no filler.`,
        messages: [{ role: 'user', content: `Question: ${question}\n\nAnswer:\n${answer}` }],
        maxTokens: 512,
      });

      const filePath = this.writer.writeInteractionContext(question, res.content);
      this.logger.info({ filePath }, 'Zoro wrote interaction context');
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Zoro: interaction recording failed');
    }

    // Enrich knowledge base with web search for this topic (fire and forget)
    if (this.webSearchEnabled) {
      void this.enrichFromWeb(question);
    }

    // Update user profile with any new personal info mentioned in this conversation
    if (chatId) {
      void this.extractAndUpdateUserProfile(chatId, question, answer);
    }
  }

  private async extractAndUpdateUserProfile(chatId: string, question: string, answer: string): Promise<void> {
    try {
      const existing = this.writer.readUserProfile(chatId) ?? '';
      const res = await this.llm.chat({
        system: `You extract personal information about users from conversations.
Look for: name, location/city, interests, hobbies, job/role, tech stack, favourite projects, age, preferences.
Given the existing profile and this new Q&A, extract ONLY NEW facts not already in the profile.
If nothing new found, return exactly: NONE
Otherwise return bullet points only (max 5), e.g.:
- Location: Mumbai, India
- Interests: cricket, anime
Do NOT repeat anything already in the profile.`,
        messages: [{
          role: 'user',
          content: `Existing profile:\n${existing || '(empty)'}\n\nNew Q&A:\nQ: ${question}\nA: ${answer.substring(0, 500)}`,
        }],
        maxTokens: 150,
      });

      const extracted = res.content.trim();
      if (!extracted || extracted.toUpperCase() === 'NONE' || !extracted.includes('- ')) return;

      // Append new bullets to the profile
      const today = new Date().toISOString().slice(0, 10);
      let updated: string;
      if (existing.includes('## Known About This User')) {
        updated = existing
          .replace(/lastUpdated: \S+/, `lastUpdated: ${today}`)
          + '\n' + extracted;
      } else {
        updated = (existing || '# User Profile\n') + '\n## Known About This User\n' + extracted;
      }

      this.writer.writeUserProfile(chatId, updated);
      this.logger.info({ chatId }, 'Zoro: user profile updated with new info');
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'Zoro: user profile update failed (non-critical)');
    }
  }

  // ── Web knowledge enrichment ──────────────────────────────────────────────

  private async enrichFromWeb(question: string): Promise<void> {
    try {
      const topic = await this.extractSearchTopic(question);
      if (!topic || topic.length < 3) return;

      // Dedup: skip if we already searched this topic today
      if (this.writer.webContentExists(topic)) {
        this.logger.debug({ topic }, 'Zoro: web content already exists for today, skipping');
        return;
      }

      // Try Wikipedia first, then DuckDuckGo
      const wiki = await this.searchWikipedia(topic);
      if (wiki) {
        const content = `${wiki.summary}`;
        const filePath = this.writer.writeWebContent(topic, 'Wikipedia', content);
        this.logger.info({ topic, source: 'Wikipedia', filePath }, 'Zoro: web knowledge enriched');
        return;
      }

      const ddg = await this.searchDuckDuckGo(question);
      if (ddg?.summary) {
        const content = `${ddg.summary}\n\nSource: ${ddg.source ?? 'DuckDuckGo'}`;
        const filePath = this.writer.writeWebContent(topic, ddg.source ?? 'DuckDuckGo', content);
        this.logger.info({ topic, source: 'DuckDuckGo', filePath }, 'Zoro: web knowledge enriched');
      }
    } catch (err) {
      this.logger.debug({ err: String(err) }, 'Zoro: web enrichment failed (non-critical)');
    }
  }

  private async extractSearchTopic(question: string): Promise<string | null> {
    if (!this.llm) return null;
    try {
      const res = await this.llm.chat({
        system: `Extract the main searchable topic from this text as 2-5 words suitable for a Wikipedia search.
Return ONLY the topic words, nothing else. No punctuation.
Examples: "write fibonacci in python" → "fibonacci algorithm"
         "how does react hooks work" → "react hooks"
         "Hi brook" → ""  (return empty for greetings/chats)`,
        messages: [{ role: 'user', content: question }],
        maxTokens: 15,
      });
      const topic = res.content.trim().toLowerCase().replace(/[^\w\s]/g, '').trim();
      return topic.length > 2 ? topic : null;
    } catch {
      return null;
    }
  }

  private async searchWikipedia(topic: string): Promise<{ title: string; summary: string } | null> {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'merry-telegram-bot/1.0 (+https://github.com/PrateekDahiya/Merry)' },
      });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const data = await res.json() as { extract?: string; title?: string };
      if (!data.extract || data.extract.length < 50) return null;
      return { title: data.title ?? topic, summary: data.extract };
    } catch {
      return null;
    }
  }

  private async searchDuckDuckGo(query: string): Promise<{ summary: string; source?: string } | null> {
    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'merry-telegram-bot/1.0' },
      });
      if (!res.ok) return null;
      const data = await res.json() as { Abstract?: string; AbstractSource?: string };
      if (!data.Abstract || data.Abstract.length < 30) return null;
      return { summary: data.Abstract, source: data.AbstractSource };
    } catch {
      return null;
    }
  }

  // ── BaseAgent (ad-hoc one-shot status query) ──────────────────────────────

  protected async doWork(_task: TaskEnvelope): Promise<unknown> {
    return { status: 'ok', active: this.active, stats: this.getStats() };
  }

  // ── Discovery loop ────────────────────────────────────────────────────────

  private async discoveryLoop(): Promise<void> {
    while (this.active) {
      await this.discoverRepos();
      await sleep(this.discoveryIntervalMs);
    }
  }

  private async discoverRepos(): Promise<void> {
    let repos: GitHubRepo[];
    try {
      repos = await this.githubGet<GitHubRepo[]>(
        `https://api.github.com/user/repos?per_page=100&sort=pushed&type=owner`
      );
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Zoro: repo discovery failed');
      return;
    }

    let newRepos = 0;
    for (const repo of repos) {
      if (this.tracker.isRepoKnown(repo.full_name)) continue;
      try {
        const files = await this.getFileTree(repo);
        this.tracker.registerRepo(repo.full_name, files);
        newRepos++;
        this.logger.info(
          { repo: repo.full_name, owner: this._username, fileCount: files.length },
          'Zoro discovered repo'
        );
      } catch (err) {
        if (isForbiddenError(err)) {
          // Register with empty file list so the discovery loop never retries this repo
          this.tracker.registerRepo(repo.full_name, []);
          this.logger.warn(
            { repo: repo.full_name, err: String(err) },
            'Zoro: 403 forbidden on repo tree — repo registered as inaccessible, will not retry'
          );
        } else if (isRateLimitError(err)) {
          this.logger.warn({ repo: repo.full_name, err: String(err) }, 'Zoro: rate limit during discovery, will retry next cycle');
        } else {
          this.logger.warn({ repo: repo.full_name, err: String(err) }, 'Zoro: tree fetch failed');
        }
      }
    }

    if (newRepos > 0) {
      this.logger.info({ newRepos, total: repos.length }, 'Zoro discovery complete');
    }
  }

  private async getFileTree(repo: GitHubRepo): Promise<string[]> {
    const tree = await this.githubGet<{ tree: GitHubTreeItem[]; truncated?: boolean }>(
      `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`
    );

    if (tree.truncated) {
      this.logger.warn({ repo: repo.full_name }, 'Zoro: tree truncated (very large repo), some files skipped');
    }

    const files = (tree.tree ?? [])
      .filter(item => item.type === 'blob')
      .filter(item => !SKIP_PATHS.test(item.path))
      .filter(item => (item.size ?? 0) < MAX_FILE_BYTES)
      .map(item => item.path);

    // Priority files first so high-value context lands in knowledge base quickly
    files.sort((a, b) => {
      const pa = PRIORITY_FILES.test(a) ? 0 : 1;
      const pb = PRIORITY_FILES.test(b) ? 0 : 1;
      return pa - pb;
    });

    return files;
  }

  // ── Worker loop ───────────────────────────────────────────────────────────

  private async workerLoop(workerId: number): Promise<void> {
    this.logger.debug({ workerId }, 'Zoro worker started');

    while (this.active) {
      this.monitor?.recordHeartbeat('zoro-primary', 'zoro');
      const work = this.tracker.claimNextWork();

      if (!work) {
        await sleep(this.workerIdleMs);
        continue;
      }

      this.logger.debug({ workerId, repo: work.repo, file: work.filePath }, 'Worker claimed file');
      await this.processFile(work.repo, work.filePath, workerId);
    }

    this.logger.debug({ workerId }, 'Zoro worker stopped');
  }

  private async processFile(repo: string, filePath: string, workerId = 0): Promise<void> {
    try {
      const content = await this.fetchFileContent(repo, filePath);

      if (!content) {
        // Binary or empty file — skip permanently
        this.tracker.markFileDone(repo, filePath);
        return;
      }

      const summary = await this.summarise(repo, filePath, content);
      const written = this.writer.writeRepoContext(repo, filePath, summary);
      this.tracker.markFileDone(repo, filePath);

      const stats = this.tracker.getStats();
      this.logger.info(
        { workerId, repo, filePath, written, pending: stats.pendingFiles, done: stats.processedFiles },
        'Zoro indexed file'
      );
    } catch (err) {
      if (isRetryableError(err)) {
        // Network/rate-limit error — release file back to queue, worker sleeps
        this.tracker.releaseWork(repo, filePath);
        this.logger.warn(
          { workerId, repo, filePath, sleepMs: this.rateLimitSleepMs, err: String(err) },
          'Zoro: transient error — file released, worker sleeping'
        );
        await sleep(this.rateLimitSleepMs);
      } else if (isForbiddenError(err)) {
        // 403 Forbidden — not a rate limit, permanent access denial
        this.tracker.skipFile(repo, filePath, String(err));
        this.logger.warn(
          { workerId, repo, filePath, err: String(err) },
          'Zoro: 403 forbidden — file permanently skipped'
        );
      } else {
        // Other permanent error (bad encoding, parse error, etc.)
        this.tracker.markFileDone(repo, filePath);
        this.logger.warn(
          { workerId, repo, filePath, err: String(err) },
          'Zoro: file failed, skipping'
        );
      }
    }
  }

  private async fetchFileContent(repo: string, filePath: string): Promise<string | null> {
    const data = await this.githubGet<{ content?: string; encoding?: string; size?: number }>(
      `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(filePath)}`
    );

    if (!data.content || data.encoding !== 'base64') return null;
    const decoded = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    return decoded.substring(0, MAX_FILE_BYTES);
  }

  private async summarise(repo: string, filePath: string, content: string): Promise<string> {
    const res = await this.llm.chat({
      system: SUMMARISE_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          `Repository: ${repo}`,
          `File: ${filePath}`,
          ``,
          '```',
          content.substring(0, 8000),
          '```',
        ].join('\n'),
      }],
      maxTokens: 1024,
    });

    return res.content;
  }

  private async githubGet<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = res.headers.get('x-ratelimit-reset');
        const resetAt = reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown';
        throw new Error(`GitHub rate limit hit. Resets at ${resetAt}`);
      }
      // Try to read the body for a secondary rate-limit message
      let body: { message?: string } = {};
      try { body = await res.json() as { message?: string }; } catch { /* ignore */ }
      const msg = body.message ?? '';

      if (msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('secondary')) {
        throw new Error(`GitHub secondary rate limit: ${msg}`);
      }
      // Genuine 403 — permanent, no point retrying
      throw new Error(`GITHUB_FORBIDDEN: ${msg || 'access denied'}`);
    }

    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
}

/** Returns true for GitHub 403 Forbidden — permanent, never retry. */
function isForbiddenError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err));
  return msg.startsWith('GITHUB_FORBIDDEN:');
}

/**
 * Returns true for transient errors that are worth retrying:
 *   - Rate limits (HTTP 429, "rate limit", "too many requests")
 *   - Network failures ("fetch failed", ECONNREFUSED, ECONNRESET, timeouts)
 *   - Ollama/LLM temporarily unreachable
 *
 * Returns false only for permanent errors that retrying cannot fix:
 *   - GITHUB_FORBIDDEN (handled separately by isForbiddenError)
 *   - Malformed/binary content
 */
function isRetryableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    // Rate limits
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('tokens per minute') ||
    msg.includes('requests per minute') ||
    // Network / connection errors — LLM or GitHub temporarily unreachable
    msg.includes('fetch failed') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('connection refused') ||
    msg.includes('failed to fetch')
  );
}

/** @deprecated use isRetryableError */
const isRateLimitError = isRetryableError;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
