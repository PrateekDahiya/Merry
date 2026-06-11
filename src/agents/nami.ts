import { BaseAgent } from './base.js';
import { ContextResponse, TaskEnvelope } from '../types/messages.js';
import { RepositoryContextSearch, RepositorySearchOptions } from '../context/repository-search.js';

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
 * Phase 4 implements repository, docs, and config search over local text files.
 */
export class NamiAgent extends BaseAgent {
  private readonly search: RepositoryContextSearch;

  constructor(options: RepositorySearchOptions = {}) {
    super('nami-primary', 'nami');
    this.search = new RepositoryContextSearch(options);
  }

  protected async doWork(task: TaskEnvelope): Promise<ContextResponse> {
    this.logger.info({ taskId: task.taskId }, 'Nami retrieving context');

    const context = await this.search.search(task.taskId, task.userRequest);
    this.logger.info(
      { taskId: task.taskId, findingCount: context.findings.length },
      'Nami context retrieval completed'
    );

    return context;
  }
}
