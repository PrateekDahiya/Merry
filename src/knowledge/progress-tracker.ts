import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface RepoProgress {
  status: 'pending' | 'in_progress' | 'done';
  discoveredAt: string;
  pendingFiles: string[];
  processedFiles: string[];
  lastProcessedAt?: string;
}

export interface ZoroProgress {
  schemaVersion: 1;
  lastUpdated: string;
  repos: Record<string, RepoProgress>;
}

const EMPTY: ZoroProgress = { schemaVersion: 1, lastUpdated: new Date().toISOString(), repos: {} };

/**
 * Tracks which repos and files Zoro has indexed.
 * Backed by knowledge/.zoro-progress.json — persists across restarts.
 */
export class ProgressTracker {
  private data: ZoroProgress;
  private readonly filePath: string;

  constructor(knowledgeDir: string) {
    this.filePath = `${knowledgeDir}/.zoro-progress.json`;
    this.data = this.load();
  }

  private load(): ZoroProgress {
    if (!existsSync(this.filePath)) return { ...EMPTY };
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf-8')) as ZoroProgress;
    } catch {
      return { ...EMPTY };
    }
  }

  private save(): void {
    this.data.lastUpdated = new Date().toISOString();
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  /** Register a repo with its full file list for processing. */
  registerRepo(repo: string, files: string[]): void {
    if (this.data.repos[repo]) return;  // already registered
    this.data.repos[repo] = {
      status: 'pending',
      discoveredAt: new Date().toISOString(),
      pendingFiles: files,
      processedFiles: [],
    };
    this.save();
  }

  /** Mark one file in a repo as processed. */
  markFileDone(repo: string, filePath: string): void {
    const r = this.data.repos[repo];
    if (!r) return;
    r.status = 'in_progress';
    r.pendingFiles = r.pendingFiles.filter(f => f !== filePath);
    if (!r.processedFiles.includes(filePath)) r.processedFiles.push(filePath);
    r.lastProcessedAt = new Date().toISOString();
    if (r.pendingFiles.length === 0) r.status = 'done';
    this.save();
  }

  /** Returns the next (repo, file) to process, or null if nothing pending. */
  getNextWork(): { repo: string; filePath: string } | null {
    for (const [repo, progress] of Object.entries(this.data.repos)) {
      if (progress.pendingFiles.length > 0) {
        return { repo, filePath: progress.pendingFiles[0]! };
      }
    }
    return null;
  }

  isRepoKnown(repo: string): boolean {
    return repo in this.data.repos;
  }

  getStats(): { totalRepos: number; doneRepos: number; pendingFiles: number; processedFiles: number; lastUpdated: string } {
    const repos = Object.values(this.data.repos);
    return {
      totalRepos: repos.length,
      doneRepos: repos.filter(r => r.status === 'done').length,
      pendingFiles: repos.reduce((sum, r) => sum + r.pendingFiles.length, 0),
      processedFiles: repos.reduce((sum, r) => sum + r.processedFiles.length, 0),
      lastUpdated: this.data.lastUpdated,
    };
  }

  getLastUpdated(): Date {
    return new Date(this.data.lastUpdated);
  }
}
