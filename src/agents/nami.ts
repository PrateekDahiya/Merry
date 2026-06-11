import { BaseAgent } from './base.js';
import { ContextResponse, TaskEnvelope } from '../types/messages.js';

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
 * Phase 4 will implement full repository search.
 * Phase 3 returns a structured placeholder so Ace can coordinate context.
 */
export class NamiAgent extends BaseAgent {
  constructor() {
    super('nami-primary', 'nami');
  }

  protected async doWork(task: TaskEnvelope): Promise<ContextResponse> {
    this.logger.info({ taskId: task.taskId }, 'Nami retrieving context');

    return {
      taskId: task.taskId,
      findings: [],
      summary: 'Phase 4 context retrieval is not implemented yet. No repository snippets were attached.',
      timestamp: new Date(),
    };
  }
}
