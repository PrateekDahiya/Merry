import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { TonyMonitor, MonitorAlert } from '../monitoring/monitor.js';
import { TaskStore, ResultStore, getStore } from '../persistence/store.js';

interface TonyAgentOptions {
  store?: TaskStore & ResultStore;
  monitor?: TonyMonitor;
}

/**
 * Tony - Health Monitoring and Watchdog Agent
 *
 * Tony wraps TonyMonitor, which runs an independent background check loop.
 * As a BaseAgent subclass, Tony can also be executed as a one-shot health query.
 * The primary monitoring path is via TonyMonitor.start() / TonyMonitor.stop().
 */
export class TonyAgent extends BaseAgent {
  private readonly monitor: TonyMonitor;

  constructor(options: TonyAgentOptions = {}) {
    super('tony-primary', 'tony');
    const store = options.store ?? getStore();
    this.monitor = options.monitor ?? new TonyMonitor(store, {
      checkIntervalMs: 5000,
      stuckThresholdMs: 60000,
    });
  }

  getMonitor(): TonyMonitor {
    return this.monitor;
  }

  override async onStart(): Promise<void> {
    this.monitor.start();
    this.logger.info('Tony watchdog started');
  }

  override async onStop(): Promise<void> {
    this.monitor.stop();
    this.logger.info('Tony watchdog stopped');
  }

  /**
   * One-shot health snapshot for ad-hoc queries.
   * Returns the current state: agent statuses + stuck task count.
   */
  protected async doWork(_task: TaskEnvelope): Promise<unknown> {
    await this.monitor.runChecks();

    return {
      status: 'ok',
      agentStatuses: this.monitor.getAgentStatuses(),
      checkedAt: new Date().toISOString(),
    };
  }
}

export { MonitorAlert };
