import { TaskStore, ResultStore } from '../persistence/store.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'tony-monitor' });

export type AlertType = 'stuck_task' | 'agent_unhealthy' | 'queue_overload' | 'repeated_failures' | 'zoro_stalled';
export type AlertSeverity = 'warning' | 'critical';

export interface MonitorAlert {
  type: AlertType;
  severity: AlertSeverity;
  details: string;
  affectedTaskIds?: string[];
  suggestedAction: string;
  timestamp: Date;
}

export type AlertHandler = (alert: MonitorAlert) => Promise<void>;

export interface AgentHeartbeat {
  agentId: string;
  agentType: string;
  healthy: boolean;
  lastHeartbeat: Date;
  activeTaskCount: number;
  errorCount: number;
  message?: string;
}

export interface ZoroHealthSource {
  getStats(): { pendingFiles: number; processedFiles: number; lastUpdated: string };
}

export interface MonitorConfig {
  checkIntervalMs: number;
  stuckThresholdMs: number;
  zoroStalledThresholdMs?: number;
}

/**
 * TonyMonitor — background health watchdog.
 *
 * Runs a periodic loop that:
 *  1. Detects tasks stuck in running/delegated states
 *  2. Checks for missing agent heartbeats
 *  3. Monitors queue overload conditions
 *
 * Calls registered alert handlers when issues are found.
 * Ace registers a handler and can then escalate, retry, or cancel.
 */
export class TonyMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly alertHandlers: AlertHandler[] = [];
  private readonly agentHeartbeats: Map<string, AgentHeartbeat> = new Map();
  private running = false;

  private zoroSource?: ZoroHealthSource;

  constructor(
    private readonly store: TaskStore & ResultStore,
    private readonly config: MonitorConfig,
  ) {}

  setZoroSource(source: ZoroHealthSource): void {
    this.zoroSource = source;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervalHandle = setInterval(() => {
      void this.runChecks();
    }, this.config.checkIntervalMs);

    logger.info(
      { intervalMs: this.config.checkIntervalMs, stuckThresholdMs: this.config.stuckThresholdMs },
      'Tony monitor started'
    );
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    logger.info('Tony monitor stopped');
  }

  onAlert(handler: AlertHandler): void {
    this.alertHandlers.push(handler);
  }

  recordHeartbeat(agentId: string, agentType: string, info: Partial<Omit<AgentHeartbeat, 'agentId' | 'agentType' | 'lastHeartbeat'>> = {}): void {
    const existing = this.agentHeartbeats.get(agentId);
    this.agentHeartbeats.set(agentId, {
      agentId,
      agentType,
      healthy: true,
      activeTaskCount: 0,
      errorCount: 0,
      ...existing,
      ...info,
      lastHeartbeat: new Date(),
    });
  }

  getAgentStatuses(): AgentHeartbeat[] {
    return Array.from(this.agentHeartbeats.values());
  }

  async runChecks(): Promise<void> {
    try {
      await Promise.all([
        this.checkStuckTasks(),
        this.checkAgentHeartbeats(),
        this.checkQueueLoad(),
        this.checkZoroHealth(),
      ]);
    } catch (err) {
      logger.error({ err: String(err) }, 'Tony monitor check cycle failed');
    }
  }

  private async checkStuckTasks(): Promise<void> {
    const [running, delegated] = await Promise.all([
      this.store.listTasksByState('running'),
      this.store.listTasksByState('delegated'),
    ]);

    const candidates = [...running, ...delegated];
    const now = Date.now();

    const stuck = candidates.filter(task => {
      const ageMs = now - new Date(task.timestamp).getTime();
      return ageMs > this.config.stuckThresholdMs;
    });

    if (stuck.length === 0) return;

    const taskIds = stuck.map(t => t.taskId);
    logger.warn({ count: stuck.length, taskIds }, 'Tony detected stuck tasks');

    await this.emit({
      type: 'stuck_task',
      severity: stuck.length >= 3 ? 'critical' : 'warning',
      details: `${stuck.length} task(s) have been running for over ${this.config.stuckThresholdMs / 1000}s without completing.`,
      affectedTaskIds: taskIds,
      suggestedAction: 'Review each task ID for deadlocks or infinite loops; consider cancelling and retrying.',
      timestamp: new Date(),
    });
  }

  private async checkAgentHeartbeats(): Promise<void> {
    const now = Date.now();

    for (const [, health] of this.agentHeartbeats) {
      const silenceMs = now - health.lastHeartbeat.getTime();

      if (silenceMs > this.config.stuckThresholdMs * 2) {
        logger.warn(
          { agentId: health.agentId, silenceMs },
          'Tony detected agent heartbeat silence'
        );

        await this.emit({
          type: 'agent_unhealthy',
          severity: 'critical',
          details: `Agent ${health.agentId} (${health.agentType}) has not reported in ${Math.round(silenceMs / 1000)}s.`,
          suggestedAction: `Verify that agent ${health.agentId} is still running. Consider restarting the worker.`,
          timestamp: new Date(),
        });
      }
    }
  }

  private async checkQueueLoad(): Promise<void> {
    const [received, acknowledged] = await Promise.all([
      this.store.listTasksByState('received'),
      this.store.listTasksByState('acknowledged'),
    ]);

    const queueDepth = received.length + acknowledged.length;

    if (queueDepth > 50) {
      logger.warn({ queueDepth }, 'Tony detected queue overload');

      await this.emit({
        type: 'queue_overload',
        severity: queueDepth > 100 ? 'critical' : 'warning',
        details: `Queue has ${queueDepth} unprocessed tasks (received + acknowledged).`,
        suggestedAction: 'Consider throttling inbound messages or adding more worker capacity.',
        timestamp: new Date(),
      });
    }
  }

  private async checkZoroHealth(): Promise<void> {
    if (!this.zoroSource) return;

    const stats = this.zoroSource.getStats();
    const stalledThresholdMs = this.config.zoroStalledThresholdMs ?? this.config.stuckThresholdMs * 5;
    const silenceMs = Date.now() - new Date(stats.lastUpdated).getTime();

    if (stats.pendingFiles > 0 && silenceMs > stalledThresholdMs) {
      logger.warn({ pendingFiles: stats.pendingFiles, silenceMs }, 'Tony: Zoro appears stalled');
      await this.emit({
        type: 'zoro_stalled',
        severity: 'warning',
        details: `Zoro has ${stats.pendingFiles} pending files but hasn't processed anything in ${Math.round(silenceMs / 60000)}min. Processed so far: ${stats.processedFiles} files.`,
        suggestedAction: 'Check Zoro logs. It may have hit a GitHub rate limit or crashed.',
        timestamp: new Date(),
      });
    }
  }

  private async emit(alert: MonitorAlert): Promise<void> {
    for (const handler of this.alertHandlers) {
      try {
        await handler(alert);
      } catch (err) {
        logger.error({ err: String(err), alertType: alert.type }, 'Alert handler threw');
      }
    }
  }
}
