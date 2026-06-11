import { TaskEnvelope } from '../types/messages.js';
import { ResultStore, TaskStore } from '../persistence/store.js';
import { createChildLogger } from '../logging/logger.js';
import { TomTaskDispatcher } from '../telegram/types.js';
import { AceAgent } from '../agents/ace.js';
import { isOrchestrationResult } from './result.js';

/**
 * Telegram-to-Ace dispatch boundary.
 * Phase 3 routes incoming Tom tasks through Ace and returns the synthesized
 * final response when orchestration succeeds.
 */
export class Phase2AceDispatcher implements TomTaskDispatcher {
  private readonly logger = createChildLogger({ component: 'phase2-ace-dispatcher' });

  constructor(
    private readonly store: TaskStore & ResultStore,
    private readonly ace: AceAgent = new AceAgent({ store })
  ) {}

  async dispatch(task: TaskEnvelope): Promise<string> {
    await this.store.saveTask(task);
    await this.store.updateTaskState(task.taskId, 'delegated');
    this.logger.info({ taskId: task.taskId, assignedAgent: task.assignedAgent }, 'Task handed off to Ace');

    const result = await this.ace.execute(task);

    if (result.success && isOrchestrationResult(result.result)) {
      return result.result.finalResponse;
    }

    return result.error
      ? `Ace failed while processing the request: ${result.error}`
      : 'Ace could not produce a final response.';
  }
}
