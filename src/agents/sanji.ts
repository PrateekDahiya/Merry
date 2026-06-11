import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';

/**
 * Sanji - Coding Agent
 *
 * Responsibilities:
 * - Implementation and code generation
 * - Debugging and troubleshooting
 * - Refactoring
 * - Code-specific tasks
 * - Safe approval/checkpoint mechanism for risky changes
 *
 * Phase 5 will implement model-backed coding capabilities.
 * Phase 3 returns a deterministic specialist response for orchestration.
 */
export class SanjiAgent extends BaseAgent {
  constructor() {
    super('sanji-primary', 'sanji');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Sanji processing coding task');

    return {
      status: 'completed',
      agent: 'sanji',
      taskId: task.taskId,
      response: `Sanji received the coding request: "${task.userRequest}". Model-backed implementation will be added in Phase 5.`,
      safety: 'No code changes were attempted by this Phase 3 worker.',
    };
  }
}
