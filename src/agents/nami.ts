import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';

/**
 * Nami - Context Retrieval Agent
 *
 * Responsibilities:
 * - Search the repository, docs, and config files
 * - Search indexed local sources
 * - Return structured context with source paths
 * - Provide relevant snippets and recommendations
 * - Support easy extension with new context sources
 *
 * Phase 4 will implement full context retrieval.
 * Phase 1 skeleton provides structure only.
 */
export class NamiAgent extends BaseAgent {
  constructor() {
    super('nami-primary', 'nami');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    this.logger.info({ taskId: task.taskId }, 'Nami retrieving context');

    // Phase 4 will implement:
    // 1. Repository/codebase indexing
    // 2. Documentation search
    // 3. Config file lookup
    // 4. Local source search
    // 5. Context ranking and filtering
    // 6. Structured response building

    return {
      status: 'not_implemented',
      message: 'Nami context retrieval will be implemented in Phase 4',
      taskId: task.taskId,
    };
  }
}
