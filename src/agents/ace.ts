import { BaseAgent } from './base.js';
import { NamiAgent } from './nami.js';
import { RobinAgent } from './robin.js';
import { SanjiAgent } from './sanji.js';
import { SpecialistOutput } from './specialists.js';
import { AgentResult, AgentType, TaskEnvelope } from '../types/messages.js';
import { ResultStore, TaskStore, getStore } from '../persistence/store.js';
import { OrchestrationResult } from '../orchestrator/result.js';
import { RoutingDecision, selectSpecialistAgent } from '../orchestrator/routing.js';
import { TonyMonitor, MonitorAlert } from '../monitoring/monitor.js';
import { LlmClient } from '../llm/client.js';
import type { ZoroAgent } from './zoro.js';
import { KnowledgeWriter } from '../knowledge/writer.js';
import { notifier } from '../telegram/notifier.js';

const DESTRUCTIVE_PATTERNS = [
  'delete all', 'drop table', 'drop database', 'truncate',
  'wipe', 'erase all', 'rm -rf', 'overwrite all',
  'deploy to production', 'force push', 'push to main', 'push to master',
];

type AgentFactory = () => BaseAgent;

interface AceAgentOptions {
  store?: TaskStore & ResultStore;
  contextAgentFactory?: AgentFactory;
  specialistFactories?: Partial<Record<AgentType, AgentFactory>>;
  monitor?: TonyMonitor;
  llm?: LlmClient;
  zoro?: ZoroAgent;
  chatHistoryTurns?: number;
  knowledgeDir?: string;
}

/**
 * Ace - Master Orchestrator Agent
 *
 * Owns: task routing, context coordination, specialist delegation,
 * result synthesis, approval gating for destructive operations,
 * and escalation handling via Tony's alerts.
 */
export class AceAgent extends BaseAgent {
  private readonly store: TaskStore & ResultStore;
  private readonly contextAgentFactory: AgentFactory;
  private readonly specialistFactories: Partial<Record<AgentType, AgentFactory>>;
  private readonly monitor?: TonyMonitor;
  private readonly zoro?: ZoroAgent;
  private readonly llm?: LlmClient;
  private readonly chatHistoryTurns: number;
  private readonly profileWriter?: KnowledgeWriter;

  constructor(options: AceAgentOptions = {}) {
    super('ace-primary', 'ace');
    this.store = options.store ?? getStore();
    this.monitor = options.monitor;
    this.zoro = options.zoro;
    this.llm = options.llm;
    this.chatHistoryTurns = options.chatHistoryTurns ?? 5;
    if (options.knowledgeDir) {
      this.profileWriter = new KnowledgeWriter(options.knowledgeDir);
    }

    this.contextAgentFactory = options.contextAgentFactory ?? (() => new NamiAgent());
    this.specialistFactories = options.specialistFactories ?? {
      robin: () => new RobinAgent(options.llm),
      sanji: () => new SanjiAgent(options.llm),
    };

    if (this.monitor) {
      this.monitor.onAlert((alert: MonitorAlert) => this.handleMonitorAlert(alert));
    }
  }

  protected async doWork(task: TaskEnvelope): Promise<OrchestrationResult> {
    this.logger.info({ taskId: task.taskId }, 'Ace received task for orchestration');

    await this.store.saveTask({ ...task, state: 'running', assignedAgent: 'ace' });
    await this.store.updateTaskState(task.taskId, 'waiting_for_context');

    // Randomly narrate what Ace is doing (30% chance — keeps it natural, not noisy)
    if (rarely(0.3)) {
      void notifier.send(Number(task.chatId), 'ace', 'routing');
    }

    // Run Nami context fetch + LLM routing classification in parallel — zero latency cost
    const [contextResult, routing] = await Promise.all([
      this.requestContext(task),
      selectSpecialistAgent(task.userRequest, this.llm),
    ]);
    await this.store.saveResult(contextResult);

    const specialist = this.createSpecialist(routing);

    await this.store.updateTaskState(task.taskId, 'delegated');

    // Build a tagged conversation chain so specialists know who said what.
    // Skip history for casual greetings — "Hi Brook" shouldn't see old Python code.
    const isCasualGreeting = isCasualRequest(task.userRequest);
    const [namiSummary, history] = await Promise.all([
      Promise.resolve(extractNamiSummary(contextResult.result)),
      isCasualGreeting ? Promise.resolve([]) : this.fetchChatHistory(task.chatId, task.taskId),
    ]);

    const profileSummary = this.profileWriter
      ? summariseUserProfile(this.profileWriter.readUserProfile(task.chatId))
      : null;

    const conversationChain: Array<{ agent: string; content: string }> = [
      ...(profileSummary ? [{ agent: 'user profile', content: profileSummary }] : []),
      ...history,   // ← recent turns
      { agent: 'user', content: task.userRequest },
      { agent: 'ace',  content: `Routing to ${routing.agent}: ${routing.reason}` },
      ...(namiSummary ? [{ agent: 'nami context', content: `Background reference from knowledge base (do NOT treat as user-provided code):\n${namiSummary}` }] : []),
    ];

    const specialistTask: TaskEnvelope = {
      ...task,
      state: 'running',
      assignedAgent: routing.agent,
      context: {
        ...task.context,
        nami: contextResult.result,
        respondAs: routing.respondAs ?? undefined,
        conversationChain,
      },
      constraints: {
        ...task.constraints,
        expectedOutputFormat: 'SpecialistOutput JSON',
      },
      metadata: {
        ...task.metadata,
        routing,
      },
    };

    await this.store.saveTask(specialistTask);
    const specialistResult = await specialist.execute(specialistTask);
    await this.store.saveResult(specialistResult);

    const requiresApproval = this.checkApprovalRequired(specialistResult, task.userRequest);

    if (requiresApproval) {
      await this.store.updateTaskState(task.taskId, 'awaiting_approval');
    }

    const finalResponse = this.synthesizeFinalResponse(routing, specialistResult, requiresApproval);

    await this.store.saveTask({
      ...specialistTask,
      state: requiresApproval ? 'awaiting_approval' : (specialistResult.success ? 'completed' : 'failed'),
      context: {
        ...specialistTask.context,
        finalResponse,
      },
    });

    this.logger.info(
      {
        taskId: task.taskId,
        selectedAgent: routing.agent,
        success: specialistResult.success,
        requiresApproval,
      },
      'Ace orchestration completed'
    );

    // Notify Zoro to record this interaction as knowledge (fire-and-forget)
    if (this.zoro && specialistResult.success && !requiresApproval) {
      void this.zoro.recordInteraction(task.userRequest, finalResponse, task.chatId);
    }

    return {
      taskId: task.taskId,
      finalResponse,
      selectedAgent: routing.agent,
      routing,
      contextResult,
      specialistResult,
    };
  }

  private async requestContext(task: TaskEnvelope): Promise<AgentResult> {
    const contextAgent = this.contextAgentFactory();
    const contextTask: TaskEnvelope = {
      ...task,
      state: 'waiting_for_context',
      assignedAgent: 'nami',
      constraints: {
        ...task.constraints,
        expectedOutputFormat: 'ContextResponse',
      },
    };
    return contextAgent.execute(contextTask);
  }

  private createSpecialist(routing: RoutingDecision): BaseAgent {
    const factory = this.specialistFactories[routing.agent];
    if (!factory) {
      this.logger.warn({ selectedAgent: routing.agent }, 'Selected specialist unavailable; falling back to Robin');
      return new RobinAgent();
    }
    return factory();
  }

  private checkApprovalRequired(result: AgentResult, originalRequest: string): boolean {
    const requestIsDestructive = DESTRUCTIVE_PATTERNS.some(kw =>
      originalRequest.toLowerCase().includes(kw)
    );
    if (requestIsDestructive) return true;

    if (!result.success || !result.result) return false;
    const parsed = SpecialistOutput.safeParse(result.result);
    return parsed.success && parsed.data.requiresApproval === true;
  }

  private synthesizeFinalResponse(
    routing: RoutingDecision,
    specialistResult: AgentResult,
    requiresApproval: boolean,
  ): string {
    if (!specialistResult.success) {
      return `🔥 Ace here — this one slipped through. ${specialistResult.error ?? 'Something went wrong on my end.'} I'll make sure it doesn't happen twice.`;
    }

    const parsed = SpecialistOutput.safeParse(specialistResult.result);

    const parts: string[] = [];

    if (parsed.success) {
      parts.push(parsed.data.response);

      if (parsed.data.warnings.length > 0) {
        parts.push('');
        parts.push(parsed.data.warnings.map(w => `⚠️ ${w}`).join('\n'));
      }
    } else if (typeof specialistResult.result === 'string') {
      parts.push(specialistResult.result);
    } else {
      parts.push(JSON.stringify(specialistResult.result));
    }

    if (requiresApproval) {
      const reason = parsed.success
        ? (parsed.data.approvalReason ?? 'This operation requires my approval.')
        : 'This operation requires my approval.';
      parts.push('');
      parts.push(`🔥 ACE CHECKPOINT: ${reason}`);
      parts.push('Reply "approve" to proceed or "cancel" to abort. I won\'t let the crew act without the all-clear.');
    }

    this.logger.debug(
      { agent: routing.agent, confidence: routing.confidence, reason: routing.reason },
      'Routing decision'
    );

    return parts.filter(Boolean).join('\n');
  }

  private async handleMonitorAlert(alert: MonitorAlert): Promise<void> {
    this.logger.warn(
      {
        alertType: alert.type,
        severity: alert.severity,
        affectedTasks: alert.affectedTaskIds,
      },
      `Tony alert: ${alert.details}`
    );
    // Always notify for critical; 30% chance for warnings
    const shouldNotify = alert.severity === 'critical' || rarely(0.3);
    if (shouldNotify) {
      const chatIds = alert.affectedTaskIds
        ? await Promise.all(alert.affectedTaskIds.map(id => this.store.getTask(id)))
          .then(tasks => [...new Set(tasks.filter(Boolean).map(t => Number(t!.chatId)))])
        : [];
      const event = alert.severity === 'critical' ? 'error' : 'working';
      for (const chatId of chatIds) {
        void notifier.send(chatId, 'tony', event);
      }
    }

    if (alert.type === 'stuck_task' && alert.affectedTaskIds) {
      for (const taskId of alert.affectedTaskIds) {
        await this.store.updateTaskState(taskId, 'stuck');
        this.logger.info({ taskId }, 'Ace marked stuck task');
      }
    }
  }

  /**
   * Retrieves recent completed turns for this chat and formats them as
   * [prev user] / [prev assistant] chain entries.
   * Hard limits: 500 chars per response, 2000 chars total — keeps history lean.
   */
  private async fetchChatHistory(
    chatId: string,
    currentTaskId: string,
  ): Promise<Array<{ agent: string; content: string }>> {
    if (this.chatHistoryTurns === 0) return [];

    const RESPONSE_MAX = 500;
    const HISTORY_MAX = 2000;

    try {
      const recent = await this.store.listTasksByChatId(chatId, (this.chatHistoryTurns + 1) * 3);
      const completed = recent
        .filter(t => t.state === 'completed' && t.taskId !== currentTaskId)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-this.chatHistoryTurns);

      const entries: Array<{ agent: string; content: string }> = [];
      let totalChars = 0;

      for (const t of completed) {
        const response = typeof t.context?.['finalResponse'] === 'string'
          ? t.context['finalResponse'] as string
          : null;
        if (!response) continue;

        const userContent = t.userRequest;
        const assistantContent = response.length > RESPONSE_MAX
          ? response.substring(0, RESPONSE_MAX) + '...'
          : response;

        totalChars += userContent.length + assistantContent.length;
        if (totalChars > HISTORY_MAX) break;

        entries.push(
          { agent: 'prev user',      content: userContent },
          { agent: 'prev assistant', content: assistantContent },
        );
      }

      return entries;
    } catch {
      return [];   // history is optional — never break the main flow
    }
  }
}

/** Returns true with the given probability (0–1). Used to randomly narrate actions. */
function rarely(probability: number): boolean {
  return Math.random() < probability;
}

const QUESTION_WORDS = /\b(what|how|why|when|where|who|which|can|could|would|should|write|create|build|explain|help|tell|show|give|make|find|fix|debug|implement|generate)\b/i;
const CREW_FIRST_NAMES_ACE = new Set(['ace','jinbe','nami','robin','sanji','zoro','tony','brook','franky','luffy','chopper']);
const GREETING_FIRST_WORDS = new Set(['hello','hi','hey','howdy','yo','sup','hiya','good','bye','yohoho','nakama','super']);

/** Returns true for short casual greetings that don't need history or context. */
function isCasualRequest(request: string): boolean {
  const trimmed = request.trim();
  if (trimmed.length > 40) return false;                   // longer messages always get history
  if (QUESTION_WORDS.test(trimmed)) return false;           // questions get history
  const words = trimmed.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length > 4) return false;
  const nonGreeting = words.filter(w => !GREETING_FIRST_WORDS.has(w) && !CREW_FIRST_NAMES_ACE.has(w));
  return nonGreeting.length === 0;
}

/**
 * Extracts a compact single-line summary from the user profile markdown.
 * Returns null if no profile or no "Known About" section.
 */
function summariseUserProfile(profileText: string | null): string | null {
  if (!profileText) return null;
  const lines = profileText.split('\n');
  const bullets = lines
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).trim())
    .filter(Boolean)
    .slice(0, 6);
  if (bullets.length === 0) return null;
  const summary = bullets.join(' | ');
  return summary.length > 300 ? summary.substring(0, 297) + '...' : summary;
}

/** Extract a plain-text summary from Nami's AgentResult for the conversation chain. */
function extractNamiSummary(namiResult: unknown): string | null {
  if (!namiResult || typeof namiResult !== 'object') return null;
  const r = namiResult as Record<string, unknown>;
  const parts: string[] = [];

  if (Array.isArray(r['findings'])) {
    const findings = r['findings'] as Array<{ source?: string; snippet?: string }>;
    for (const f of findings.slice(0, 4)) {
      if (f.source && f.snippet) {
        parts.push(`[${f.source}]: ${f.snippet.substring(0, 400)}`);
      }
    }
  }
  if (typeof r['summary'] === 'string' && r['summary']) {
    parts.push(r['summary']);
  }
  return parts.length > 0 ? parts.join('\n\n') : null;
}
