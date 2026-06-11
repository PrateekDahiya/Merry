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

  constructor(options: AceAgentOptions = {}) {
    super('ace-primary', 'ace');
    this.store = options.store ?? getStore();
    this.monitor = options.monitor;

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

    const contextResult = await this.requestContext(task);
    await this.store.saveResult(contextResult);

    const routing = selectSpecialistAgent(task.userRequest);
    const specialist = this.createSpecialist(routing);

    await this.store.updateTaskState(task.taskId, 'delegated');

    const specialistTask: TaskEnvelope = {
      ...task,
      state: 'running',
      assignedAgent: routing.agent,
      context: {
        ...task.context,
        nami: contextResult.result,
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
      return `Ace could not complete the request because ${routing.agent} failed: ${specialistResult.error ?? 'unknown error'}`;
    }

    const specialistOutput = this.extractSpecialistResponse(specialistResult.result);

    const parts = [
      specialistOutput,
      '',
      `Handled by ${routing.agent}. Routing confidence: ${routing.confidence.toFixed(2)}. ${routing.reason}`,
    ];

    if (requiresApproval) {
      const parsed = SpecialistOutput.safeParse(specialistResult.result);
      const reason = parsed.success ? (parsed.data.approvalReason ?? 'This operation requires approval.') : 'This operation requires approval.';
      parts.push('');
      parts.push(`⚠️ APPROVAL REQUIRED: ${reason}`);
      parts.push('Reply with "approve" or "yes" to proceed, or "cancel" to abort.');
    }

    return parts.join('\n');
  }

  private extractSpecialistResponse(result: unknown): string {
    const parsed = SpecialistOutput.safeParse(result);

    if (parsed.success) {
      return [
        parsed.data.title,
        parsed.data.response,
        '',
        `Summary: ${parsed.data.summary}`,
        parsed.data.nextSteps.length > 0 ? `Next steps:\n${parsed.data.nextSteps.map(s => `  • ${s}`).join('\n')}` : '',
        parsed.data.warnings.length > 0 ? `Warnings:\n${parsed.data.warnings.map(w => `  ⚠ ${w}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (typeof result === 'string') return result;

    if (result && typeof result === 'object' && 'response' in result) {
      const r = (result as { response?: unknown }).response;
      if (typeof r === 'string') return r;
    }

    return JSON.stringify({ result });
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

    if (alert.type === 'stuck_task' && alert.affectedTaskIds) {
      for (const taskId of alert.affectedTaskIds) {
        await this.store.updateTaskState(taskId, 'stuck');
        this.logger.info({ taskId }, 'Ace marked stuck task');
      }
    }
  }
}
