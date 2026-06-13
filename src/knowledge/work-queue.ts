import PQueue from 'p-queue';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'work-queue' });

export interface WorkItem {
  repo: string;
  filePath: string;
  priority: number;   // lower = higher priority (1 = README, 10 = CSS)
}

/**
 * Priority work queue for Zoro's knowledge indexing.
 * Uses p-queue (in-memory, no Redis) with configurable concurrency.
 *
 * Priority assignment:
 *   1  — README.md, overview files (most valuable)
 *   2  — Entry points: index.ts, main.ts, app.ts, index.py
 *   3  — Source code files (.ts, .js, .py, .go, etc.)
 *   8  — Config files (package.json, tsconfig, etc.)
 *   10 — Style files (.css, .scss) and others
 */
export class ZoroWorkQueue {
  private readonly queue: PQueue;
  private pending = 0;
  private processed = 0;

  constructor(concurrency = 3) {
    this.queue = new PQueue({ concurrency });
    logger.info({ concurrency }, 'ZoroWorkQueue created');
  }

  /** Assign a priority to a file based on its path. */
  static priorityFor(filePath: string): number {
    const lower = filePath.toLowerCase();
    if (/readme\.md$/i.test(lower)) return 1;
    if (/(^|\/)+(index|main|app)\.(ts|js|py|go|rb|java)$/.test(lower)) return 2;
    if (/\.(ts|js|py|go|rs|java|rb|swift|kt|cpp|c)$/.test(lower)) return 3;
    if (/\.(json|yaml|yml|toml|config)$/.test(lower)) return 8;
    return 10;
  }

  /** Add a work item to the queue. */
  async add(item: WorkItem, handler: (item: WorkItem) => Promise<void>): Promise<void> {
    this.pending++;
    return this.queue.add(async () => {
      try {
        await handler(item);
        this.processed++;
      } finally {
        this.pending = Math.max(0, this.pending - 1);
      }
    }, { priority: 10 - item.priority });  // p-queue: higher number = higher priority
  }

  get size(): number { return this.queue.size; }
  get pendingCount(): number { return this.pending; }
  get processedCount(): number { return this.processed; }
  get isIdle(): boolean { return this.queue.size === 0 && this.queue.pending === 0; }

  /** Wait for all queued work to complete. */
  async onIdle(): Promise<void> {
    return this.queue.onIdle();
  }

  /** Pause processing (e.g., on rate limit). */
  pause(): void { this.queue.pause(); }

  /** Resume processing. */
  resume(): void { this.queue.start(); }

  /** Clear all pending items. */
  clear(): void { this.queue.clear(); }
}
