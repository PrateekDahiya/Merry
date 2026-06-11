import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { LlmClient, MockLlmClient } from '../llm/client.js';
import { ProgressTracker } from '../knowledge/progress-tracker.js';
import { KnowledgeWriter } from '../knowledge/writer.js';

export interface ZoroOptions {
  knowledgeDir: string;
  githubToken: string;
  githubUsername: string;
  llm?: LlmClient;
  indexIntervalMs?: number;
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

const SKIP_PATHS = /node_modules|\.git|dist|coverage|\.next|\.cache|__pycache__|\.min\.|package-lock|yarn\.lock|\.png|\.jpg|\.jpeg|\.gif|\.ico|\.svg|\.woff|\.ttf|\.eot/i;
const PRIORITY_FILES = /readme\.md|package\.json|index\.(ts|js|py|go|rs|java)|app\.(ts|js|py)|main\.(ts|js|py|go|rs)/i;
const MAX_FILE_BYTES = 60_000;

const SYSTEM_PROMPT = `You are Zoro, a knowledge extraction specialist.
Analyze the provided code or documentation file and produce a concise, searchable knowledge document.

Rules:
- Be specific: include function names, class names, algorithms, and data structures
- Explain what the file does and how it fits into the project
- Note key patterns, APIs, or design decisions
- Max 400 words
- Use markdown with clear headers
- Do NOT reproduce raw code blocks; summarize and explain instead

Output a clean markdown document only.`;

/**
 * Zoro — Knowledge Base Builder Agent
 *
 * Runs a background loop that:
 *  1. Discovers all user GitHub repos and their file trees
 *  2. Picks one unprocessed file at a time
 *  3. Fetches the file content from GitHub
 *  4. Summarizes it with the LLM
 *  5. Writes the result to knowledge/repos/{repo}/{file}.md
 *  6. Updates the progress tracker (restartable)
 *
 * Also records user interactions as knowledge files so the bot
 * improves from conversations over time.
 */
export class ZoroAgent extends BaseAgent {
  private readonly llm: LlmClient;
  private readonly tracker: ProgressTracker;
  private readonly writer: KnowledgeWriter;
  private readonly token: string;
  private readonly _username: string;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(options: ZoroOptions) {
    super('zoro-primary', 'zoro');
    this.llm = options.llm ?? new MockLlmClient();
    this.token = options.githubToken;
    this._username = options.githubUsername;
    this.intervalMs = options.indexIntervalMs ?? 30_000;
    this.tracker = new ProgressTracker(options.knowledgeDir);
    this.writer = new KnowledgeWriter(options.knowledgeDir);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  startIndexing(): void {
    if (this.active) return;
    this.active = true;
    this.logger.info({ intervalMs: this.intervalMs }, 'Zoro knowledge indexer started');
    void this.tick();
  }

  stopIndexing(): void {
    this.active = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.logger.info('Zoro knowledge indexer stopped');
  }

  getStats() {
    return this.tracker.getStats();
  }

  // ── Interaction recording (called by Ace after each task) ─────────────────

  async recordInteraction(question: string, answer: string): Promise<void> {
    try {
      const prompt = `User question: ${question}\n\nAnswer given:\n${answer}`;
      const llmRes = await this.llm.chat({
        system: `You are Zoro, a knowledge extraction specialist.
Extract the key facts and technical details from this Q&A exchange.
Write a concise markdown knowledge entry (max 200 words) that would help answer similar questions in the future.
Start with a # heading summarising the topic.`,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 512,
      });

      const filePath = this.writer.writeInteractionContext(question, llmRes.content);
      this.logger.info({ filePath }, 'Zoro wrote interaction context');
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Zoro: interaction recording failed');
    }
  }

  // ── BaseAgent doWork (one-shot ad-hoc execution) ──────────────────────────

  protected async doWork(_task: TaskEnvelope): Promise<unknown> {
    const stats = this.tracker.getStats();
    return { status: 'ok', stats, active: this.active };
  }

  // ── Core indexing loop ────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (!this.active) return;

    try {
      // Discover new repos we haven't seen yet
      await this.discoverRepos();

      // Process the next pending file
      const work = this.tracker.getNextWork();
      if (work) {
        await this.processFile(work.repo, work.filePath);
      } else {
        this.logger.debug('Zoro: knowledge base up to date, nothing pending');
      }
    } catch (err) {
      this.logger.error({ err: String(err) }, 'Zoro tick failed');
    }

    // Schedule next tick
    this.timer = setTimeout(() => void this.tick(), this.intervalMs);
  }

  private async discoverRepos(): Promise<void> {
    let repos: GitHubRepo[];
    try {
      repos = await this.githubGet<GitHubRepo[]>(
        `https://api.github.com/user/repos?per_page=100&sort=pushed&type=owner`
      );
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'Zoro: could not list GitHub repos');
      return;
    }

    for (const repo of repos) {
      if (this.tracker.isRepoKnown(repo.full_name)) continue;

      try {
        const files = await this.getFileTree(repo);
        this.tracker.registerRepo(repo.full_name, files);
        this.logger.info(
          { repo: repo.full_name, owner: this._username, fileCount: files.length },
          'Zoro discovered new repo'
        );
      } catch (err) {
        this.logger.warn({ repo: repo.full_name, err: String(err) }, 'Zoro: tree fetch failed');
      }
    }
  }

  private async getFileTree(repo: GitHubRepo): Promise<string[]> {
    const tree = await this.githubGet<{ tree: GitHubTreeItem[] }>(
      `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch}?recursive=1`
    );

    const files = tree.tree
      .filter(item => item.type === 'blob')
      .filter(item => !SKIP_PATHS.test(item.path))
      .filter(item => (item.size ?? 0) < MAX_FILE_BYTES)
      .map(item => item.path);

    // Sort: priority files (README, index, main) go first
    files.sort((a, b) => {
      const aPriority = PRIORITY_FILES.test(a) ? 0 : 1;
      const bPriority = PRIORITY_FILES.test(b) ? 0 : 1;
      return aPriority - bPriority;
    });

    return files;
  }

  private async processFile(repo: string, filePath: string): Promise<void> {
    this.logger.info({ repo, filePath }, 'Zoro processing file');

    try {
      const content = await this.fetchFileContent(repo, filePath);
      if (!content) {
        this.tracker.markFileDone(repo, filePath);
        return;
      }

      const summary = await this.summarize(repo, filePath, content);
      const written = this.writer.writeRepoContext(repo, filePath, summary);
      this.tracker.markFileDone(repo, filePath);

      const stats = this.tracker.getStats();
      this.logger.info(
        { repo, filePath, written, pending: stats.pendingFiles, done: stats.processedFiles },
        'Zoro file indexed'
      );
    } catch (err) {
      this.logger.warn({ repo, filePath, err: String(err) }, 'Zoro: file processing failed, skipping');
      this.tracker.markFileDone(repo, filePath);
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

  private async summarize(repo: string, filePath: string, content: string): Promise<string> {
    const repoName = repo.split('/').pop() ?? repo;

    const userPrompt = [
      `Repository: ${repo}`,
      `File: ${filePath}`,
      ``,
      `Content:`,
      `\`\`\``,
      content.substring(0, 8000),
      `\`\`\``,
    ].join('\n');

    const res = await this.llm.chat({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 1024,
    });

    // Prepend source metadata so Nami's search can use it
    return [
      `<!-- source: github:${repo}/${filePath} -->`,
      `<!-- repo: ${repoName} -->`,
      ``,
      res.content,
    ].join('\n');
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
      if (remaining === '0') throw new Error('GitHub rate limit hit');
      throw new Error('GitHub 403 Forbidden');
    }

    if (!res.ok) throw new Error(`GitHub ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
}
