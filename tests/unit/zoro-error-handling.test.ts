import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ProgressTracker } from '../../src/knowledge/progress-tracker.js';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), `merry-zoro-${Date.now()}`);

describe('ProgressTracker error handling', () => {
  beforeEach(() => mkdirSync(testDir, { recursive: true }));
  afterEach(() => { if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true }); });

  it('releaseWork puts file back at end of pending queue', () => {
    const tracker = new ProgressTracker(testDir);
    tracker.registerRepo('owner/repo', ['a.ts', 'b.ts', 'c.ts']);

    const work = tracker.claimNextWork()!;
    expect(work.filePath).toBe('a.ts');

    // Release it (simulates rate-limit)
    tracker.releaseWork('owner/repo', 'a.ts');

    // Next claim should get b.ts, not a.ts again
    const next = tracker.claimNextWork()!;
    expect(next.filePath).toBe('b.ts');

    // a.ts is still pending (at the end)
    const stats = tracker.getStats();
    expect(stats.pendingFiles).toBe(2); // b.ts claimed, a.ts and c.ts pending
  });

  it('released file is eventually retried', () => {
    const tracker = new ProgressTracker(testDir);
    tracker.registerRepo('owner/repo', ['a.ts', 'b.ts']);

    const first = tracker.claimNextWork()!;
    tracker.releaseWork('owner/repo', first.filePath); // release a.ts

    const second = tracker.claimNextWork()!; // gets b.ts
    tracker.markFileDone('owner/repo', second.filePath);

    const third = tracker.claimNextWork()!; // gets a.ts (released earlier)
    expect(third.filePath).toBe('a.ts');
  });

  it('crash recovery: claimedFiles moved back to pending on next startup', () => {
    const tracker1 = new ProgressTracker(testDir);
    tracker1.registerRepo('owner/repo', ['a.ts', 'b.ts']);
    tracker1.claimNextWork(); // a.ts is now claimed, process crashes

    // New startup — a.ts should be recovered back to pending
    const tracker2 = new ProgressTracker(testDir);
    const stats = tracker2.getStats();
    expect(stats.claimedFiles).toBe(0);
    expect(stats.pendingFiles).toBe(2); // a.ts recovered + b.ts still pending

    const work = tracker2.claimNextWork()!;
    expect(work.filePath).toBe('a.ts'); // recovered file is retried
  });

  it('markFileDone never counts a file twice', () => {
    const tracker = new ProgressTracker(testDir);
    tracker.registerRepo('owner/repo', ['a.ts']);
    tracker.claimNextWork();
    tracker.markFileDone('owner/repo', 'a.ts');
    tracker.markFileDone('owner/repo', 'a.ts'); // duplicate call

    expect(tracker.getStats().processedFiles).toBe(1);
  });
});
