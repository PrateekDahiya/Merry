import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface RepoProgress {
  status: 'pending' | 'in_progress' | 'done';
  discoveredAt: string;
  pendingFiles: string[];
  claimedFiles: string[];    // currently being processed by a worker
  processedFiles: string[];
  skippedFiles: string[];    // permanently skipped (403 forbidden, bad encoding, etc.)
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

  /** Recover crashed claims and backfill skippedFiles on old progress files. */
  private recoverCrashedClaims(): void {
    let changed = false;
    for (const progress of Object.values(this.data.repos)) {
      if (!progress.claimedFiles) { progress.claimedFiles = []; changed = true; }
      if (!progress.skippedFiles) { progress.skippedFiles = []; changed = true; }

      if (progress.claimedFiles.length > 0) {
        progress.pendingFiles = [...progress.claimedFiles, ...progress.pendingFiles];
        progress.claimedFiles = [];
        progress.status = 'in_progress';
        changed = true;
      }
    }
    if (changed) this.save();
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
      skippedFiles: [],
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
   * Permanently skip a file — moves it to skippedFiles and removes from all
   * other lists. claimNextWork() will never return it again.
   * Use for 403 Forbidden, binary files, or any other permanent failure.
   */
  skipFile(repo: string, filePath: string, reason?: string): void {
    const r = this.data.repos[repo];
    if (!r) return;

    r.pendingFiles = r.pendingFiles.filter(f => f !== filePath);
    r.claimedFiles = r.claimedFiles.filter(f => f !== filePath);
    if (!r.skippedFiles.includes(filePath)) r.skippedFiles.push(filePath);

    if (r.pendingFiles.length === 0 && r.claimedFiles.length === 0) {
      r.status = 'done';
    }
    this.save();

    // reason is used by callers for logging, stored here for reference
    void reason;
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
      skippedFiles: repos.reduce((n, r) => n + r.skippedFiles.length, 0),
      lastUpdated: this.data.lastUpdated,
    };
  }

  getLastUpdated(): Date {
    return new Date(this.data.lastUpdated);
  }
}
