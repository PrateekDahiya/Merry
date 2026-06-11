import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { SpecialistOutput, callRobinLlm } from './specialists.js';
import { LlmClient, MockLlmClient } from '../llm/client.js';
import { notifier } from '../telegram/notifier.js';

export class RobinAgent extends BaseAgent {
  private readonly llm: LlmClient;

  constructor(llm?: LlmClient) {
    super('robin-primary', 'robin');
    this.llm = llm ?? new MockLlmClient();
  }

  protected async doWork(task: TaskEnvelope): Promise<SpecialistOutput> {
    const contextSummary = extractContextSummary(task);

    this.logger.info(
      { taskId: task.taskId, hasContext: Boolean(contextSummary), contextLen: contextSummary?.length ?? 0 },
      'Robin processing writing task'
    );

    if (Math.random() < 0.3) {
      void notifier.send(Number(task.chatId), 'robin', 'working');
    }

    return callRobinLlm(this.llm, task, contextSummary);
  }
}

function extractContextSummary(task: TaskEnvelope): string | undefined {
  const context = task.context;
  if (!context) return undefined;

  const namiContext = context['nami'];
  const parts: string[] = [];

  // Character impersonation — must appear first so LLM sees it immediately
  const respondAs = context['respondAs'] as string | null | undefined;
  if (respondAs) {
    parts.push(`[RESPOND AS: ${respondAs}]`);
  }

  if (namiContext && typeof namiContext === 'object') {
    const ctx = namiContext as Record<string, unknown>;

    // Include actual code/text findings — this is what the LLM should reason from
    if (Array.isArray(ctx['findings'])) {
      const findings = ctx['findings'] as Array<{ source?: string; snippet?: string }>;
      for (const f of findings.slice(0, 6)) {
        if (f.source && f.snippet) {
          parts.push(`[${f.source}]\n${f.snippet.substring(0, 600)}`);
        }
      }
    }

    // Append the summary line after the snippets
    if (typeof ctx['summary'] === 'string' && ctx['summary']) {
      parts.push(ctx['summary']);
    }
  }

  // Any other context keys passed along (constraints, metadata hints, etc.)
  const otherKeys = Object.keys(context).filter(k => k !== 'nami' && k !== 'finalResponse');
  for (const key of otherKeys) {
    parts.push(`${key}: ${stringify(context[key])}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
