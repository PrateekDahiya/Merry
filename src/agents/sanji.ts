import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { SpecialistOutput, callSanjiLlm } from './specialists.js';
import { LlmClient, MockLlmClient } from '../llm/client.js';

/**
 * Sanji - Coding Agent
 *
 * Provides implementation-focused, code-precise technical guidance via a real
 * LLM (or mock for dev/test). Automatically flags destructive operations for
 * approval before execution.
 */
export class SanjiAgent extends BaseAgent {
  private readonly llm: LlmClient;

  constructor(llm?: LlmClient) {
    super('sanji-primary', 'sanji');
    this.llm = llm ?? new MockLlmClient();
  }

  protected async doWork(task: TaskEnvelope): Promise<SpecialistOutput> {
    const contextSummary = extractContextSummary(task);

    this.logger.info(
      { taskId: task.taskId, hasContext: Boolean(contextSummary) },
      'Sanji processing coding task'
    );

    return callSanjiLlm(this.llm, task, contextSummary);
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
    'findings' in namiContext &&
    Array.isArray((namiContext as Record<string, unknown>)['findings'])
  ) {
    const findings = (namiContext as Record<string, unknown>)['findings'] as Array<{
      source?: string;
      snippet?: string;
    }>;
    for (const f of findings.slice(0, 6)) {
      if (f.source && f.snippet) {
        parts.push(`[${f.source}]\n${f.snippet.substring(0, 600)}`);
      }
    }
  } else if (
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
