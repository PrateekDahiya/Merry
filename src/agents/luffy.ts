import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { TaskStore, ResultStore, ChatMetadataStore } from '../persistence/store.js';
import { TonyMonitor } from '../monitoring/monitor.js';
import { ZoroAgent } from './zoro.js';
import { notifier } from '../telegram/notifier.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'luffy' });

export interface LuffyOptions {
  store: TaskStore & ResultStore & ChatMetadataStore;
  monitor?: TonyMonitor;
  zoro?: ZoroAgent;
  intervalMs?: number;
  firstFireDelayMs?: number;
  reportToChat?: boolean;
  reportChance?: number;
  expectedIntervals?: {
    brook?: number;
    franky?: number;
    crew?: number;
  };
}

interface AgentStatus {
  status: 'active' | 'idle' | 'silent' | 'never' | 'unknown' | 'not_configured';
  lastSeen?: string;
  detail?: string;
}

interface InspectionReport {
  jinbe: AgentStatus & { taskCount: number };
  ace: { total: number; completed: number; failed: number; failRate: number };
  sanji: { tasks: number; correctlyRouted: number; suspicious: number };
  brook: AgentStatus;
  franky: AgentStatus;
  crew: AgentStatus;
  zoro: AgentStatus & Record<string, unknown>;
  tony: { healthy: number; unhealthy: string[] };
  concerns: string[];
}

// Same coding keywords as routing.ts — must match for correct routing verification
const CODING_KEYWORDS = ['code', 'bug', 'debug', 'implement', 'refactor', 'typescript',
  'javascript', 'test', 'function', 'class', 'api', 'repo', 'error'];

/**
 * Luffy — The Captain.
 *
 * While Tony monitors system health, Luffy monitors BEHAVIOURAL correctness:
 *   - Is Jinbe actually routing messages from Telegram?
 *   - Is Ace completing tasks and routing them correctly?
 *   - Is Sanji handling code when given code questions?
 *   - Is Brook singing/fetching news on schedule?
 *   - Is Franky running crew conversations?
 *   - Is Zoro building the knowledge base?
 *
 * Luffy logs a structured report every cycle and optionally sends a casual
 * "captain's check-in" message to the Telegram chat so the user knows the
 * crew is working as intended.
 *
 * GOMU GOMU NO! 🍖
 */
export class LuffyAgent extends BaseAgent {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly store: TaskStore & ResultStore & ChatMetadataStore;
  private readonly monitor?: TonyMonitor;
  private readonly zoro?: ZoroAgent;
  private readonly intervalMs: number;
  private readonly firstFireDelayMs: number;
  private readonly reportToChat: boolean;
  private readonly reportChance: number;
  private readonly expectedBrook: number;
  private readonly expectedFranky: number;
  private readonly expectedCrew: number;

  constructor(options: LuffyOptions) {
    super('luffy-primary', 'luffy');
    this.store = options.store;
    this.monitor = options.monitor;
    this.zoro = options.zoro;
    this.intervalMs = options.intervalMs ?? 1_800_000;        // 30 min
    this.firstFireDelayMs = options.firstFireDelayMs ?? 45_000; // 45s
    this.reportToChat = options.reportToChat ?? true;
    this.reportChance = options.reportChance ?? 0.4;
    this.expectedBrook = options.expectedIntervals?.brook ?? 5_400_000;
    this.expectedFranky = options.expectedIntervals?.franky ?? 2_700_000;
    this.expectedCrew = options.expectedIntervals?.crew ?? 1_200_000;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.timer = setTimeout(() => {
      void this.run().finally(() => this.scheduleNext());
    }, this.firstFireDelayMs);
    logger.info({ intervalMs: this.intervalMs, firstFireMs: this.firstFireDelayMs }, 'Luffy started — GOMU GOMU NO! 🍖');
  }

  stop(): void {
    this.active = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    logger.info('Luffy stopped — I trust my crew! 🍖');
  }

  protected async doWork(_task: TaskEnvelope): Promise<unknown> {
    return { status: 'ok', active: this.active };
  }

  private scheduleNext(): void {
    if (!this.active) return;
    const jitter = (Math.random() - 0.5) * 0.3 * this.intervalMs;
    this.timer = setTimeout(() => {
      void this.run().finally(() => this.scheduleNext());
    }, Math.max(60_000, this.intervalMs + jitter));
  }

  private async run(): Promise<void> {
    if (!this.active) return;

    const [report, chatIds] = await Promise.all([
      this.inspect(),
      this.store.listAllChatIds(),
    ]);

    // Log structured report always
    logger.info(
      { ...report, msg: undefined },
      'Luffy captain\'s inspection complete'
    );

    // Send chat message randomly OR always when there are concerns
    const hasConcerns = report.concerns.length > 0;
    const shouldReport = this.reportToChat && chatIds.length > 0 &&
      (hasConcerns || Math.random() < this.reportChance);

    if (shouldReport) {
      const message = this.buildChatMessage(report);
      for (const chatId of chatIds) {
        try {
          await notifier.sendRaw(Number(chatId), message);
        } catch (err) {
          logger.warn({ chatId, err: String(err) }, 'Luffy: chat send failed');
        }
      }
    }
  }

  // ── Checks ────────────────────────────────────────────────────────────────

  private async inspect(): Promise<InspectionReport> {
    const chatIds = await this.store.listAllChatIds();

    // Gather recent tasks from all known chats
    const allTasks: TaskEnvelope[] = [];
    for (const chatId of chatIds) {
      const tasks = await this.store.listTasksByChatId(chatId, 10);
      allTasks.push(...tasks);
    }

    const recentTasks = allTasks.filter(t =>
      Date.now() - new Date(t.timestamp).getTime() < 24 * 60 * 60 * 1000
    );

    const concerns: string[] = [];

    const jinbe = this.checkJinbe(recentTasks);
    const ace = this.checkAce(recentTasks);
    const sanji = this.checkSanji(recentTasks);
    const brook = await this.checkTimestampAgent('lastBrookMessageAt', chatIds, this.expectedBrook);
    const franky = await this.checkTimestampAgent('lastFrankyMessageAt', chatIds, this.expectedFranky);
    const crew = await this.checkTimestampAgent('lastCrewMessageAt', chatIds, this.expectedCrew);
    const zoroStatus = this.checkZoro();
    const tony = this.checkTony();

    if (ace.failRate > 0.3) concerns.push(`Ace: ${Math.round(ace.failRate * 100)}% task failure rate`);
    if (sanji.suspicious > 0) concerns.push(`Sanji: ${sanji.suspicious} possibly misrouted task(s)`);
    if (brook.status === 'silent') concerns.push('Brook hasn\'t sung in a while — OI BROOK!');
    if (franky.status === 'silent') concerns.push('Franky hasn\'t hosted a crew chat recently');
    if (tony.unhealthy.length > 0) concerns.push(`Tony flagged unhealthy: ${tony.unhealthy.join(', ')}`);

    return { jinbe: { ...jinbe, taskCount: recentTasks.length }, ace, sanji, brook, franky, crew, zoro: zoroStatus, tony, concerns };
  }

  private checkJinbe(tasks: TaskEnvelope[]): Omit<InspectionReport['jinbe'], 'taskCount'> {
    if (tasks.length === 0) return { status: 'idle', detail: 'no tasks in last 24h' };
    const recent2h = tasks.filter(t => Date.now() - new Date(t.timestamp).getTime() < 2 * 60 * 60 * 1000);
    return {
      status: recent2h.length > 0 ? 'active' : 'idle',
      detail: `${recent2h.length} task(s) in last 2h`,
    };
  }

  private checkAce(tasks: TaskEnvelope[]): InspectionReport['ace'] {
    const completed = tasks.filter(t => t.state === 'completed').length;
    const failed = tasks.filter(t => t.state === 'failed').length;
    const total = completed + failed;
    return { total, completed, failed, failRate: total > 0 ? failed / total : 0 };
  }

  private checkSanji(tasks: TaskEnvelope[]): InspectionReport['sanji'] {
    const sanjiTasks = tasks.filter(t => t.assignedAgent === 'sanji');
    let correctlyRouted = 0;
    let suspicious = 0;

    for (const task of sanjiTasks) {
      const lower = task.userRequest.toLowerCase();
      const hasCode = CODING_KEYWORDS.some(kw => lower.includes(kw));
      const routing = task.metadata?.['routing'] as { confidence?: number } | undefined;
      const confidence = routing?.confidence ?? 0;

      if (hasCode || confidence >= 0.7) {
        correctlyRouted++;
      } else {
        suspicious++;
        logger.debug({ taskId: task.taskId, request: task.userRequest.slice(0, 80) }, 'Luffy: Sanji routing suspicious');
      }
    }

    return { tasks: sanjiTasks.length, correctlyRouted, suspicious };
  }

  private async checkTimestampAgent(
    field: string,
    chatIds: string[],
    expectedIntervalMs: number,
  ): Promise<AgentStatus> {
    let mostRecent = 0;

    for (const chatId of chatIds) {
      const meta = await this.store.getChatMetadata(chatId);
      if (!meta?.[field]) continue;
      const t = new Date(meta[field] as string).getTime();
      if (t > mostRecent) mostRecent = t;
    }

    if (mostRecent === 0) return { status: 'never', detail: 'no record found' };

    const ageMs = Date.now() - mostRecent;
    const ageMin = Math.round(ageMs / 60_000);

    if (ageMs > expectedIntervalMs * 2) {
      return { status: 'silent', lastSeen: `${ageMin} min ago`, detail: `expected every ${Math.round(expectedIntervalMs / 60_000)}min` };
    }

    return { status: 'active', lastSeen: `${ageMin} min ago` };
  }

  private checkZoro(): AgentStatus & Record<string, unknown> {
    if (!this.zoro) return { status: 'not_configured' };
    const stats = this.zoro.getStats();
    const ageMs = Date.now() - new Date(stats.lastUpdated).getTime();
    const ageMin = Math.round(ageMs / 60_000);
    const status = ageMs > 60 * 60 * 1000 ? 'idle' : 'active';
    return { status, lastSeen: `${ageMin} min ago`, ...stats };
  }

  private checkTony(): InspectionReport['tony'] {
    if (!this.monitor) return { healthy: 0, unhealthy: [] };
    const statuses = this.monitor.getAgentStatuses();
    const unhealthy = statuses.filter(s => !s.healthy).map(s => s.agentId);
    return { healthy: statuses.filter(s => s.healthy).length, unhealthy };
  }

  // ── Chat message builder ──────────────────────────────────────────────────

  private buildChatMessage(report: InspectionReport): string {
    const hasConcerns = report.concerns.length > 0;
    const lines: string[] = [];

    if (hasConcerns) {
      lines.push('🍖 Oi! Captain\'s report — something\'s off!');
    } else {
      lines.push('🍖 Captain\'s check-in!');
    }

    lines.push('');
    lines.push(this.statusLine('Jinbe', report.jinbe.status, report.jinbe.detail ?? `${report.jinbe.taskCount} task(s) today`));
    lines.push(this.statusLine('Ace', report.ace.failRate > 0.3 ? 'silent' : 'active',
      `${report.ace.completed}/${report.ace.total} tasks completed`));
    lines.push(this.statusLine('Sanji', report.sanji.suspicious > 0 ? 'silent' : 'active',
      report.sanji.tasks > 0 ? `handled ${report.sanji.tasks} task(s)` : 'no coding tasks yet'));
    lines.push(this.statusLine('Robin', 'active', 'answering questions'));
    lines.push(this.statusLine('Brook', report.brook.status, report.brook.lastSeen ? `last sang ${report.brook.lastSeen}` : 'no record'));
    lines.push(this.statusLine('Franky', report.franky.status, report.franky.lastSeen ? `last chat ${report.franky.lastSeen}` : 'no record'));
    lines.push(this.statusLine('Zoro', report.zoro.status,
      typeof report.zoro['processedFiles'] === 'number' ? `indexed ${report.zoro['processedFiles']} files` : ''));

    if (hasConcerns) {
      lines.push('');
      for (const c of report.concerns) {
        lines.push(`⚠️ ${c}`);
      }
      lines.push('');
      lines.push('🍖 I\'ll keep watching!');
    } else {
      lines.push('');
      lines.push('My crew is strong! GOMU GOMU NO! 🍖');
    }

    return lines.filter(l => l !== null).join('\n');
  }

  private statusLine(name: string, status: string, detail?: string): string {
    const ok = status === 'active';
    const icon = ok ? '✅' : '⚠️';
    return `${icon} ${name}${detail ? `: ${detail}` : ''}`;
  }
}
