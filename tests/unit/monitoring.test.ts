import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TonyMonitor, MonitorAlert } from '../../src/monitoring/monitor.js';
import { InMemoryStore } from '../../src/persistence/store.js';
import { TaskEnvelope } from '../../src/types/messages.js';

function makeTask(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return {
    taskId: `task-${Math.random().toString(36).slice(2)}`,
    chatId: 'chat-1',
    userId: 'user-1',
    messageId: 'msg-1',
    timestamp: new Date(),
    state: 'running',
    userRequest: 'test request',
    ...overrides,
  };
}

describe('TonyMonitor', () => {
  let store: InMemoryStore;
  let monitor: TonyMonitor;

  beforeEach(() => {
    store = new InMemoryStore();
    monitor = new TonyMonitor(store, {
      checkIntervalMs: 99999,
      stuckThresholdMs: 1000,
    });
  });

  it('emits stuck_task alert for old running tasks', async () => {
    const oldTimestamp = new Date(Date.now() - 5000);
    const task = makeTask({ state: 'running', timestamp: oldTimestamp });
    await store.saveTask(task);

    const alerts: MonitorAlert[] = [];
    monitor.onAlert(async alert => { alerts.push(alert); });

    await monitor.runChecks();

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.type).toBe('stuck_task');
    expect(alerts[0]?.affectedTaskIds).toContain(task.taskId);
  });

  it('does not emit alert for recently-started tasks', async () => {
    const task = makeTask({ state: 'running', timestamp: new Date() });
    await store.saveTask(task);

    const alerts: MonitorAlert[] = [];
    monitor.onAlert(async alert => { alerts.push(alert); });

    await monitor.runChecks();

    expect(alerts).toHaveLength(0);
  });

  it('emits critical alert when 3+ tasks are stuck', async () => {
    const oldTimestamp = new Date(Date.now() - 5000);
    for (let i = 0; i < 4; i++) {
      await store.saveTask(makeTask({ state: 'running', timestamp: oldTimestamp }));
    }

    const alerts: MonitorAlert[] = [];
    monitor.onAlert(async alert => { alerts.push(alert); });

    await monitor.runChecks();

    expect(alerts[0]?.severity).toBe('critical');
  });

  it('emits agent_unhealthy when heartbeat is stale', async () => {
    monitor.recordHeartbeat('robin-primary', 'robin');

    const health = monitor.getAgentStatuses();
    const robinHealth = health.find(h => h.agentId === 'robin-primary');
    if (robinHealth) {
      robinHealth.lastHeartbeat = new Date(Date.now() - 5 * 60 * 1000);
    }

    const alerts: MonitorAlert[] = [];
    monitor.onAlert(async alert => { alerts.push(alert); });

    await monitor.runChecks();

    expect(alerts.some(a => a.type === 'agent_unhealthy')).toBe(true);
  });

  it('marks stuck tasks in the store when Ace handles the alert', async () => {
    const oldTimestamp = new Date(Date.now() - 5000);
    const task = makeTask({ state: 'running', timestamp: oldTimestamp });
    await store.saveTask(task);

    monitor.onAlert(async alert => {
      if (alert.affectedTaskIds) {
        for (const id of alert.affectedTaskIds) {
          await store.updateTaskState(id, 'stuck');
        }
      }
    });

    await monitor.runChecks();

    const saved = await store.getTask(task.taskId);
    expect(saved?.state).toBe('stuck');
  });

  it('start/stop control the check interval', () => {
    const startSpy = vi.spyOn(global, 'setInterval');
    const stopSpy = vi.spyOn(global, 'clearInterval');

    monitor.start();
    expect(startSpy).toHaveBeenCalled();

    monitor.stop();
    expect(stopSpy).toHaveBeenCalled();
  });
});
