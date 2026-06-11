import { BaseAgent } from './base.js';
import { NamiAgent } from './nami.js';
import { RobinAgent } from './robin.js';
import { SanjiAgent } from './sanji.js';
import { SpecialistOutput } from './specialists.js';
import { AgentResult, AgentType, TaskEnvelope } from '../types/messages.js';
import { ResultStore, TaskStore, getStore } from '../persistence/store.js';
import { OrchestrationResult } from '../orchestrator/result.js';
import { RoutingDecision, selectSpecialistAgent } from '../orchestrator/routing.js';

type AgentFactory = () => BaseAgent;

interface AceAgentOptions {
  store?: TaskStore & ResultStore;
  contextAgentFactory?: AgentFactory;
  specialistFactories?: Partial<Record<AgentType, AgentFactory>>;
}

/**
 * Ace - Master Orchestrator Agent
 *
 * Responsibilities:
 * - Task routing and agent selection
 * - Request decomposition
 * - Context coordination with Nami
 * - Specialist agent delegation
 * - Result synthesis
 * - Escalation handling
 *
 * Phase 3 implements routing, lifecycle transitions, context coordination,
 * specialist delegation, and final response synthesis.
 */
export class AceAgent extends BaseAgent {
  private readonly store: TaskStore & ResultStore;
  private readonly contextAgentFactory: AgentFactory;
  private readonly specialistFactories: Partial<Record<AgentType, AgentFactory>>;

  constructor(options: AceAgentOptions = {}) {
    super('ace-primary', 'ace');
    this.store = options.store ?? getStore();
    this.contextAgentFactory = options.contextAgentFactory ?? (() => new NamiAgent());
    this.specialistFactories = options.specialistFactories ?? {
      robin: () => new RobinAgent(),
      sanji: () => new SanjiAgent(),
    };
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
        expectedOutputFormat: 'AgentResult.result must contain structured specialist output for Ace synthesis.',
      },
      metadata: {
        ...task.metadata,
        routing,
      },
    };

    await this.store.saveTask(specialistTask);
    const specialistResult = await specialist.execute(specialistTask);
    await this.store.saveResult(specialistResult);

    const finalResponse = this.synthesizeFinalResponse(routing, specialistResult);

    await this.store.saveTask({
      ...specialistTask,
      state: specialistResult.success ? 'completed' : 'failed',
      context: {
        ...specialistTask.context,
        finalResponse,
      },
    });

    this.logger.info(
      { taskId: task.taskId, selectedAgent: routing.agent, success: specialistResult.success },
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

  private synthesizeFinalResponse(routing: RoutingDecision, specialistResult: AgentResult): string {
    if (!specialistResult.success) {
      return `Ace could not complete the request because ${routing.agent} failed: ${specialistResult.error ?? 'unknown error'}`;
    }

    const specialistOutput = this.extractSpecialistResponse(specialistResult.result);

    return [
      specialistOutput,
      '',
      `Handled by ${routing.agent}. Routing confidence: ${routing.confidence.toFixed(2)}. ${routing.reason}`,
    ].join('\n');
  }

  private extractSpecialistResponse(result: unknown): string {
    const parsed = SpecialistOutput.safeParse(result);

    if (parsed.success) {
      return [
        parsed.data.title,
        parsed.data.response,
        '',
        `Summary: ${parsed.data.summary}`,
        parsed.data.nextSteps.length > 0 ? `Next steps: ${parsed.data.nextSteps.join('; ')}` : '',
        parsed.data.warnings.length > 0 ? `Warnings: ${parsed.data.warnings.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (typeof result === 'string') {
      return result;
    }

    if (result && typeof result === 'object' && 'response' in result) {
      const response = (result as { response?: unknown }).response;

      if (typeof response === 'string') {
        return response;
      }
    }

    return JSON.stringify({ result });
  }
}
