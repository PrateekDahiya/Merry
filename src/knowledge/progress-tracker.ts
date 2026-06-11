import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface RepoProgress {
  status: 'pending' | 'in_progress' | 'done';
  discoveredAt: string;
  pendingFiles: string[];
  claimedFiles: string[];    // currently being processed by a worker
  processedFiles: string[];
  lastProcessedAt?: string;
}

export interface ZoroProgress {
  schemaVersion: 1;
  lastUpdated: string;
  repos: Record<string, RepoProgress>;
}

const EMPTY: ZoroProgress = {
  schemaVersion: 1,
  lastUpdated: new Date().toISOString(),
  repos: {},
};

/**
 * Tracks which repos and files Zoro has indexed.
 * Backed by knowledge/.zoro-progress.json — persists across restarts.
 *
 * claimNextWork() is synchronous so it's atomic under Node.js's event loop:
 * two async workers calling it back-to-back will never get the same file.
 *
 * Crash recovery: any files left in claimedFiles on startup (worker crashed
 * mid-file) are moved back to pendingFiles so they're retried.
 */
export class ProgressTracker {
  private data: ZoroProgress;
  private readonly filePath: string;

  constructor(knowledgeDir: string) {
    this.filePath = `${knowledgeDir}/.zoro-progress.json`;
    this.data = this.load();
    this.recoverCrashedClaims();
  }

  private load(): ZoroProgress {
    if (!existsSync(this.filePath)) return { ...EMPTY, repos: {} };
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8')) as ZoroProgress;
    } catch {
      return { ...EMPTY, repos: {} };
    }
  }

  /** Move any previously-claimed-but-never-completed files back to pending. */
  private recoverCrashedClaims(): void {
    let recovered = 0;
    for (const progress of Object.values(this.data.repos)) {
      if (!progress.claimedFiles) progress.claimedFiles = [];
      if (progress.claimedFiles.length > 0) {
        progress.pendingFiles = [...progress.claimedFiles, ...progress.pendingFiles];
        recovered += progress.claimedFiles.length;
        progress.claimedFiles = [];
        progress.status = 'in_progress';
      }
    }
    if (recovered > 0) {
      this.save();
    }
  }

  private save(): void {
    this.data.lastUpdated = new Date().toISOString();
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  registerRepo(repo: string, files: string[]): void {
    if (this.data.repos[repo]) return;
    this.data.repos[repo] = {
      status: 'pending',
      discoveredAt: new Date().toISOString(),
      pendingFiles: files,
      claimedFiles: [],
      processedFiles: [],
    };
    this.save();
  }

  /**
   * Atomically claims the next pending file for a worker.
   * Synchronous — safe to call from multiple concurrent async workers.
   */
  claimNextWork(): { repo: string; filePath: string } | null {
    for (const [repo, progress] of Object.entries(this.data.repos)) {
      if (progress.pendingFiles.length === 0) continue;

      const filePath = progress.pendingFiles.shift()!;  // remove from front
      progress.claimedFiles.push(filePath);
      progress.status = 'in_progress';
      this.save();
      return { repo, filePath };
    }
    return null;
  }

  markFileDone(repo: string, filePath: string): void {
    const r = this.data.repos[repo];
    if (!r) return;

    r.claimedFiles = r.claimedFiles.filter(f => f !== filePath);
    if (!r.processedFiles.includes(filePath)) r.processedFiles.push(filePath);
    r.lastProcessedAt = new Date().toISOString();

    if (r.pendingFiles.length === 0 && r.claimedFiles.length === 0) {
      r.status = 'done';
    }
    this.save();
  }

  /**
   * Release a file back to the pending queue (e.g. rate limit hit).
   * The file goes to the END of the queue so other files are processed first
   * while the rate limit resets.
   */
  releaseWork(repo: string, filePath: string): void {
    const r = this.data.repos[repo];
    if (!r) return;

    r.claimedFiles = r.claimedFiles.filter(f => f !== filePath);
    if (!r.pendingFiles.includes(filePath) && !r.processedFiles.includes(filePath)) {
      r.pendingFiles.push(filePath); // back to end — retry after other files
    }
    this.save();
  }

  isRepoKnown(repo: string): boolean {
    return repo in this.data.repos;
  }

  getStats() {
    const repos = Object.values(this.data.repos);
    return {
      totalRepos: repos.length,
      doneRepos: repos.filter(r => r.status === 'done').length,
      pendingFiles: repos.reduce((n, r) => n + r.pendingFiles.length, 0),
      claimedFiles: repos.reduce((n, r) => n + r.claimedFiles.length, 0),
      processedFiles: repos.reduce((n, r) => n + r.processedFiles.length, 0),
      lastUpdated: this.data.lastUpdated,
    };
  }

  getLastUpdated(): Date {
    return new Date(this.data.lastUpdated);
  }
}
