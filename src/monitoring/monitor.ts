import { TaskStore, ResultStore, ChatMetadataStore } from '../persistence/store.js';
import { notifier } from '../telegram/notifier.js';
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
  reportIntervalMs?: number;   // how often to send a health report to chat (default 30 min)
}

/**
 * TonyMonitor — background health watchdog (Dr. Tony Tony Chopper).
 *
 * Two loops:
 *  1. checkLoop  — every checkIntervalMs: detects stuck tasks, dead agents, queue overload
 *  2. reportLoop — every reportIntervalMs: sends a health summary to the Telegram chat
 *
 * Background agents (Brook, Franky, Zoro) call recordHeartbeat() each cycle so Tony
 * can detect if any go silent.
 */
export class TonyMonitor {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private reportHandle: ReturnType<typeof setInterval> | null = null;
  private readonly alertHandlers: AlertHandler[] = [];
  private readonly agentHeartbeats: Map<string, AgentHeartbeat> = new Map();
  private running = false;
  private zoroSource?: ZoroHealthSource;
  private chatStore?: ChatMetadataStore;
  private readonly reportIntervalMs: number;

  constructor(
    private readonly store: TaskStore & ResultStore,
    private readonly config: MonitorConfig,
  ) {
    this.reportIntervalMs = config.reportIntervalMs ?? 1_800_000; // 30 min default
  }

  setZoroSource(source: ZoroHealthSource): void {
    this.zoroSource = source;
  }

  /** Provide the chat store so Tony can find active chat IDs for reports. */
  setChatStore(store: ChatMetadataStore): void {
    this.chatStore = store;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.intervalHandle = setInterval(() => {
      void this.runChecks();
    }, this.config.checkIntervalMs);

    this.reportHandle = setInterval(() => {
      void this.sendHealthReport();
    }, this.reportIntervalMs);

    logger.info(
      { checkIntervalMs: this.config.checkIntervalMs, reportIntervalMs: this.reportIntervalMs },
      'Tony monitor started'
    );
  }

  stop(): void {
    if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; }
    if (this.reportHandle)   { clearInterval(this.reportHandle);   this.reportHandle = null; }
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

  // ── Periodic health report ─────────────────────────────────────────────────

  private async sendHealthReport(): Promise<void> {
    if (!this.chatStore) return;
    const chatIds = await this.chatStore.listAllChatIds();
    if (chatIds.length === 0) return;

    const message = await this.buildHealthMessage();
    for (const chatId of chatIds) {
      try {
        await notifier.sendRaw(Number(chatId), message);
      } catch { /* non-fatal */ }
    }
    logger.debug('Tony: sent periodic health report');
  }

  private async buildHealthMessage(): Promise<string> {
    const [running, delegated, received, acknowledged] = await Promise.all([
      this.store.listTasksByState('running'),
      this.store.listTasksByState('delegated'),
      this.store.listTasksByState('received'),
      this.store.listTasksByState('acknowledged'),
    ]);

    const now = Date.now();
    const stuck = [...running, ...delegated].filter(
      t => now - new Date(t.timestamp).getTime() > this.config.stuckThresholdMs
    );
    const queueDepth = received.length + acknowledged.length;
    const heartbeats = this.getAgentStatuses();
    const silentAgents = heartbeats.filter(
      h => now - h.lastHeartbeat.getTime() > this.config.stuckThresholdMs * 2
    );

    const issues: string[] = [];
    if (stuck.length > 0) issues.push(`⚠️ ${stuck.length} stuck task(s)`);
    if (queueDepth > 10) issues.push(`⚠️ Queue depth: ${queueDepth}`);
    if (silentAgents.length > 0) issues.push(`⚠️ Silent agents: ${silentAgents.map(a => a.agentType).join(', ')}`);

    const zoroStats = this.zoroSource?.getStats();

    if (issues.length > 0) {
      return [
        `*🦌 Tony:* EMERGENCY MEDICAL REPORT!`,
        issues.join('\n'),
        `🦌 Reporting to Ace immediately! This is NOT the time to call me cute!`,
      ].join('\n');
    }

    const lines = [
      `*🦌 Tony:* Doctor's report!`,
      `✅ No stuck tasks`,
      `✅ Queue clear (${queueDepth} pending)`,
    ];

    if (heartbeats.length > 0) {
      lines.push(`✅ ${heartbeats.length} agent(s) reporting healthy`);
    }
    if (zoroStats) {
      lines.push(`✅ Zoro: ${zoroStats.processedFiles} files indexed, ${zoroStats.pendingFiles} pending`);
    }

    lines.push(`🏥 All crew members healthy!`);
    lines.push(`*(I'm NOT happy about being called cute while I work!)*`);

    return lines.join('\n');
  }

  // ── Health checks ──────────────────────────────────────────────────────────

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
      details: `🩺 Tony's diagnosis: ${stuck.length} task(s) have been running for over ${this.config.stuckThresholdMs / 1000}s with no signs of life. This isn't normal — I'm flagging it immediately! Affected IDs: ${taskIds.join(', ')}`,
      affectedTaskIds: taskIds,
      suggestedAction: 'Check each task for deadlocks or infinite loops. Consider cancelling and retrying. (And stop saying I\'m cute when I\'m doing serious medical work!)',
      timestamp: new Date(),
    });
  }

  private async checkAgentHeartbeats(): Promise<void> {
    const now = Date.now();

    for (const [, health] of this.agentHeartbeats) {
      const silenceMs = now - health.lastHeartbeat.getTime();

      if (silenceMs > this.config.stuckThresholdMs * 2) {
        logger.warn({ agentId: health.agentId, silenceMs }, 'Tony detected agent heartbeat silence');

        await this.emit({
          type: 'agent_unhealthy',
          severity: 'critical',
          details: `🩺 Tony's diagnosis: ${health.agentId} (${health.agentType}) has gone silent for ${Math.round(silenceMs / 1000)}s. Vital signs: undetected. As the ship's doctor I cannot allow a crew member to be in this condition!`,
          suggestedAction: `Verify ${health.agentId} is still running. If it crashed, restart the worker. I'll keep monitoring.`,
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
        details: `🩺 Tony's diagnosis: the queue has ${queueDepth} unprocessed tasks piling up. The crew is overwhelmed! This level of backlog is medically concerning.`,
        suggestedAction: 'Throttle incoming messages or add more worker capacity before the crew collapses from exhaustion.',
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
        details: `🩺 Tony's diagnosis: Zoro has ${stats.pendingFiles} files still pending but hasn't moved in ${Math.round(silenceMs / 60000)} minutes. That's not focus — that's unconscious. Even Zoro can't train through a system crash.`,
        suggestedAction: 'Check Zoro logs for rate limits or connection errors. He may need a restart to find his way back.',
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
