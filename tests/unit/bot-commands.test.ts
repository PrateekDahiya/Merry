import { describe, it, expect, vi } from 'vitest';
import { InMemoryStore } from '../../src/persistence/store.js';
import { TonyMonitor } from '../../src/monitoring/monitor.js';
import type { CommandDeps } from '../../src/telegram/commands.js';

// Verify the module exports the registerCommands function
describe('Bot commands module', () => {
  it('registerCommands is exported', async () => {
    const mod = await import('../../src/telegram/commands.js');
    expect(typeof mod.registerCommands).toBe('function');
  });

  it('CommandDeps requires store and monitor', () => {
    const store = new InMemoryStore();
    const monitor = new TonyMonitor(store, { checkIntervalMs: 999_999, stuckThresholdMs: 60_000 });

    const deps: CommandDeps = { store, monitor };
    expect(deps.store).toBeDefined();
    expect(deps.monitor).toBeDefined();
  });

  it('zoro and adminUserIds are optional in CommandDeps', () => {
    const store = new InMemoryStore();
    const monitor = new TonyMonitor(store, { checkIntervalMs: 999_999, stuckThresholdMs: 60_000 });
    // Should compile without zoro or adminUserIds
    const deps: CommandDeps = { store, monitor, zoro: undefined, adminUserIds: undefined };
    expect(deps).toBeDefined();
  });
});

// Test command logic in isolation using mock Telegraf context
describe('Bot command responses', () => {
  function mockCtx(chatId = 100) {
    const replies: string[] = [];
    return {
      chat: { id: chatId },
      reply: vi.fn(async (text: string) => { replies.push(text); }),
      _replies: replies,
    };
  }

  it('/help response contains all 5 commands', async () => {
    const { registerCommands } = await import('../../src/telegram/commands.js');
    const store = new InMemoryStore();
    const monitor = new TonyMonitor(store, { checkIntervalMs: 999_999, stuckThresholdMs: 60_000 });

    const commands: Record<string, Function> = {};
    const fakeBot = {
      command: (name: string, handler: Function) => { commands[name] = handler; },
    };

    registerCommands(fakeBot as any, { store, monitor });

    const ctx = mockCtx();
    await commands['help']!(ctx);
    expect(ctx._replies[0]).toContain('/status');
    expect(ctx._replies[0]).toContain('/reset');
    expect(ctx._replies[0]).toContain('/zoro');
    expect(ctx._replies[0]).toContain('/agents');
    expect(ctx._replies[0]).toContain('/help');
  });

  it('/zoro shows "Not configured" when zoro is undefined', async () => {
    const { registerCommands } = await import('../../src/telegram/commands.js');
    const store = new InMemoryStore();
    const monitor = new TonyMonitor(store, { checkIntervalMs: 999_999, stuckThresholdMs: 60_000 });

    const commands: Record<string, Function> = {};
    const fakeBot = {
      command: (name: string, handler: Function) => { commands[name] = handler; },
    };

    registerCommands(fakeBot as any, { store, monitor, zoro: undefined });

    const ctx = mockCtx();
    await commands['zoro']!(ctx);
    expect(ctx._replies[0]).toContain('Not configured');
  });

  it('/reset clears crew message timestamps', async () => {
    const { registerCommands } = await import('../../src/telegram/commands.js');
    const store = new InMemoryStore();
    const monitor = new TonyMonitor(store, { checkIntervalMs: 999_999, stuckThresholdMs: 60_000 });

    // Pre-populate some metadata
    await store.saveChatMetadata('100', { lastCrewMessageAt: '2026-01-01', lastSeenAt: '2026-01-01' });

    const commands: Record<string, Function> = {};
    const fakeBot = { command: (name: string, h: Function) => { commands[name] = h; } };
    registerCommands(fakeBot as any, { store, monitor });

    const ctx = mockCtx(100);
    await commands['reset']!(ctx);

    const meta = await store.getChatMetadata('100');
    expect(meta?.lastCrewMessageAt).toBeUndefined();
    expect(ctx._replies[0]).toContain('cleared');
  });
});
