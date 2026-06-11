import { BaseAgent } from './base.js';
import { ContextResponse, TaskEnvelope } from '../types/messages.js';
import { RepositoryContextSearch, RepositorySearchOptions } from '../context/repository-search.js';
import { GitHubContextSearch, GitHubSearchOptions } from '../context/github-search.js';

export interface NamiOptions extends RepositorySearchOptions {
  github?: GitHubSearchOptions;
}

/**
 * Nami - Context Retrieval Agent
 *
 * Aggregates context from all configured sources in parallel:
 *  - Local knowledge directory (always active)
 *  - GitHub code + repo search (when GITHUB_TOKEN + GITHUB_USERNAME are set)
 *
 * Results are merged and ranked by relevance before being passed to specialists.
 */
export class NamiAgent extends BaseAgent {
  private readonly localSearch: RepositoryContextSearch;
  private readonly githubSearch?: GitHubContextSearch;

  constructor(options: NamiOptions = {}) {
    super('nami-primary', 'nami');
    this.localSearch = new RepositoryContextSearch(options);
    if (options.github) {
      this.githubSearch = new GitHubContextSearch(options.github);
    }
  }

  protected async doWork(task: TaskEnvelope): Promise<ContextResponse> {
    const sources: string[] = ['local'];
    if (this.githubSearch) sources.push('github');

    this.logger.info({ taskId: task.taskId, sources }, 'Nami retrieving context');

    const [localResult, githubResult] = await Promise.all([
      this.localSearch.search(task.taskId, task.userRequest),
      this.githubSearch
        ? this.githubSearch.search(task.taskId, task.userRequest)
        : Promise.resolve(null),
    ]);

    const allFindings = [
      ...localResult.findings,
      ...(githubResult?.findings ?? []),
    ]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 10);

    const summaryParts = [localResult.summary];
    if (githubResult?.summary) summaryParts.push(githubResult.summary);

    const context: ContextResponse = {
      taskId: task.taskId,
      findings: allFindings,
      summary: summaryParts.filter(Boolean).join(' '),
      timestamp: new Date(),
    };

    this.logger.info(
      {
        taskId: task.taskId,
        localCount: localResult.findings.length,
        githubCount: githubResult?.findings.length ?? 0,
        totalCount: allFindings.length,
      },
      'Nami context retrieval completed'
    );

    return context;
  }
}
