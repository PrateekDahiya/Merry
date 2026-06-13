import { describe, it, expect, afterEach } from 'vitest';
import { bus, MerryEventBus, BusEventMap } from '../../src/events/bus.js';

// Re-export the class for isolated testing
import { EventEmitter2 } from 'eventemitter2';

describe('Event bus', () => {
  afterEach(() => {
    // Clean up listeners after each test
    bus.offAll();
  });

  it('bus singleton is defined', () => {
    expect(bus).toBeDefined();
    expect(typeof bus.dispatch).toBe('function');
    expect(typeof bus.subscribe).toBe('function');
  });

  it('dispatch + subscribe deliver typed events', async () => {
    const received: Array<{ taskId: string }> = [];

    bus.subscribe('task.completed', (payload) => {
      received.push({ taskId: payload.taskId });
    });

    bus.dispatch('task.completed', {
      taskId: 'task-test-1',
      chatId: 'chat-1',
      success: true,
      response: 'done',
      agentId: 'sanji-primary',
      durationMs: 100,
    });

    // EventEmitter2 is synchronous by default
    expect(received).toHaveLength(1);
    expect(received[0]?.taskId).toBe('task-test-1');
  });

  it('multiple subscribers receive the same event', () => {
    const counts = { a: 0, b: 0 };
    bus.subscribe('agent.heartbeat', () => { counts.a++; });
    bus.subscribe('agent.heartbeat', () => { counts.b++; });

    bus.dispatch('agent.heartbeat', { agentId: 'brook-primary', agentType: 'brook' });

    expect(counts.a).toBe(1);
    expect(counts.b).toBe(1);
  });

  it('offAll() clears all listeners', () => {
    let fired = false;
    bus.subscribe('task.routed', () => { fired = true; });
    bus.offAll();

    bus.dispatch('task.routed', {
      taskId: 'task-1', chatId: 'chat-1', agent: 'sanji', confidence: 0.9,
    });

    expect(fired).toBe(false);
  });

  it('alert.raised event carries severity', () => {
    let received: { severity: string } | null = null;
    bus.subscribe('alert.raised', (payload) => { received = payload; });

    bus.dispatch('alert.raised', {
      type: 'stuck_task',
      severity: 'critical',
      details: 'Task stuck for 2 minutes',
    });

    expect(received).not.toBeNull();
    expect((received as any).severity).toBe('critical');
  });
});
