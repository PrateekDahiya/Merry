import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';

/**
 * Robin - Writing Agent
 *
 * Responsibilities:
 * - Writing and editing content
 * - Summarization
 * - Natural language response generation
 * - Formatting and structuring text output
 *
 * Phase 5 will implement model-backed writing capabilities.
 * Phase 3 returns a deterministic specialist response for orchestration.
 */
export class RobinAgent extends BaseAgent {
  constructor() {
    super('robin-primary', 'robin');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Robin processing writing task');

    return {
      status: 'completed',
      agent: 'robin',
      taskId: task.taskId,
      response: `Robin received the writing request: "${task.userRequest}". Model-backed writing will be added in Phase 5.`,
      notes: ['Phase 3 verified routing, delegation, and structured return flow.'],
    };
  }
}
