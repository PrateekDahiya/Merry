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
 * Phase 5 will implement full writing capabilities.
 * Phase 1 skeleton provides structure only.
 */
export class RobinAgent extends BaseAgent {
  constructor() {
    super('robin-primary', 'robin');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Robin processing writing task');

    // Phase 5 will implement:
    // 1. Prompt template instantiation
    // 2. LLM/API calls for writing
    // 3. Output validation and formatting
    // 4. Revision handling
    // 5. Structure and clarity optimization

    return {
      status: 'not_implemented',
      message: 'Robin writing agent will be implemented in Phase 5',
      taskId: task.taskId,
    };
  }
}
