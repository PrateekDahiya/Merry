import { TaskEnvelope } from '../types/messages.js';
import { TaskStore } from '../persistence/store.js';
import { createChildLogger } from '../logging/logger.js';
import { TomTaskDispatcher } from '../telegram/types.js';

/**
 * Phase 2 handoff boundary.
 * Full Ace orchestration is implemented in Phase 3; for now Tom can persist
 * and mark tasks as delegated without doing specialist routing.
 */
export class Phase2AceDispatcher implements TomTaskDispatcher {
  private readonly logger = createChildLogger({ component: 'phase2-ace-dispatcher' });

  constructor(private readonly store: TaskStore) {}

  async dispatch(task: TaskEnvelope): Promise<void> {
    await this.store.saveTask(task);
    await this.store.updateTaskState(task.taskId, 'delegated');

    this.logger.info({ taskId: task.taskId, assignedAgent: task.assignedAgent }, 'Task handed off to Ace boundary');
  }
}
