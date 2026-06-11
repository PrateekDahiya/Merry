import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { SpecialistOutput, callRobinLlm } from './specialists.js';
import { LlmClient, MockLlmClient } from '../llm/client.js';

/**
 * Robin - Writing Agent
 *
 * Produces clear, polished writing via a real LLM (or mock for dev/test).
 * Accepts an LlmClient; defaults to MockLlmClient when none is provided.
 */
export class RobinAgent extends BaseAgent {
  private readonly llm: LlmClient;

  constructor(llm?: LlmClient) {
    super('robin-primary', 'robin');
    this.llm = llm ?? new MockLlmClient();
  }

  protected async doWork(task: TaskEnvelope): Promise<SpecialistOutput> {
    const contextSummary = extractContextSummary(task);

    this.logger.info(
      { taskId: task.taskId, hasContext: Boolean(contextSummary) },
      'Robin processing writing task'
    );

    return callRobinLlm(this.llm, task, contextSummary);
  }
}

function extractContextSummary(task: TaskEnvelope): string | undefined {
  const context = task.context;
  if (!context) return undefined;

  const keys = Object.keys(context).filter(k => k !== 'nami' && k !== 'finalResponse');
  const namiContext = context['nami'];

  const parts: string[] = [];

  if (
    namiContext &&
    typeof namiContext === 'object' &&
    'summary' in namiContext &&
    typeof (namiContext as Record<string, unknown>)['summary'] === 'string'
  ) {
    const summary = (namiContext as Record<string, unknown>)['summary'] as string;
    if (summary) parts.push(`Repository context: ${summary}`);
  }

  for (const key of keys) {
    parts.push(`${key}: ${stringify(context[key])}`);
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
