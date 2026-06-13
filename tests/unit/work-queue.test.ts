import { describe, it, expect } from 'vitest';
import { ZoroWorkQueue } from '../../src/knowledge/work-queue.js';

describe('ZoroWorkQueue', () => {
  it('priorityFor assigns 1 to README', () => {
    expect(ZoroWorkQueue.priorityFor('README.md')).toBe(1);
    expect(ZoroWorkQueue.priorityFor('src/README.md')).toBe(1);
  });

  it('priorityFor assigns 2 to entry points', () => {
    expect(ZoroWorkQueue.priorityFor('src/index.ts')).toBe(2);
    expect(ZoroWorkQueue.priorityFor('app.js')).toBe(2);
    expect(ZoroWorkQueue.priorityFor('main.py')).toBe(2);
  });

  it('priorityFor assigns 3 to source files', () => {
    expect(ZoroWorkQueue.priorityFor('src/auth.ts')).toBe(3);
    expect(ZoroWorkQueue.priorityFor('lib/utils.py')).toBe(3);
  });

  it('priorityFor assigns 10 to CSS/style files', () => {
    expect(ZoroWorkQueue.priorityFor('styles.css')).toBe(10);
    expect(ZoroWorkQueue.priorityFor('theme.scss')).toBe(10);
  });

  it('processes high-priority items before low-priority', async () => {
    const queue = new ZoroWorkQueue(1);
    queue.pause();  // pause so we can queue all items before any run

    const order: string[] = [];
    const p1 = queue.add({ repo: 'r', filePath: 'styles.css', priority: 10 }, async (item) => { order.push(item.filePath); });
    const p2 = queue.add({ repo: 'r', filePath: 'README.md', priority: 1 }, async (item) => { order.push(item.filePath); });
    const p3 = queue.add({ repo: 'r', filePath: 'auth.ts', priority: 3 }, async (item) => { order.push(item.filePath); });

    queue.resume();
    await Promise.all([p1, p2, p3]);
    await queue.onIdle();

    // README (priority 1) should finish before styles.css (priority 10)
    const readmeIdx = order.indexOf('README.md');
    const cssIdx = order.indexOf('styles.css');
    expect(readmeIdx).toBeLessThan(cssIdx);
  });

  it('tracks processedCount', async () => {
    const queue = new ZoroWorkQueue(2);
    await queue.add({ repo: 'r', filePath: 'a.ts', priority: 3 }, async () => {});
    await queue.add({ repo: 'r', filePath: 'b.ts', priority: 3 }, async () => {});
    await queue.onIdle();
    expect(queue.processedCount).toBe(2);
  });

  it('isIdle after all work completes', async () => {
    const queue = new ZoroWorkQueue(1);
    await queue.add({ repo: 'r', filePath: 'file.ts', priority: 3 }, async () => {});
    await queue.onIdle();
    expect(queue.isIdle).toBe(true);
  });
});
