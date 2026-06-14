import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { SpecialistOutput, callCrewMemberLlm } from './specialists.js';
import { LlmClient, MockLlmClient } from '../llm/client.js';
import { notifier } from '../telegram/notifier.js';
import type { AgentVoice } from '../telegram/notifier.js';

/**
 * Generic crew responder — wraps any crew member's personality and domain
 * into a single reusable BaseAgent. Ace creates these for the 6 crew members
 * beyond Robin and Sanji (Jinbe, Tony, Nami, Zoro, Brook, Franky).
 */
export class CrewResponderAgent extends BaseAgent {
  private readonly llm: LlmClient;
  private readonly member: AgentVoice;

  constructor(member: AgentVoice, llm?: LlmClient) {
    super(`${member}-responder`, member as string);
    this.member = member;
    this.llm = llm ?? new MockLlmClient();
  }

  protected async doWork(task: TaskEnvelope): Promise<SpecialistOutput> {
    const contextSummary = extractContextSummary(task);

    this.logger.info(
      { taskId: task.taskId, member: this.member, hasContext: Boolean(contextSummary) },
      `${this.member} processing request`
    );

    if (Math.random() < 0.3) {
      void notifier.send(Number(task.chatId), this.member, 'working');
    }

    return callCrewMemberLlm(this.member, this.llm, task, contextSummary);
  }
}

function extractContextSummary(task: TaskEnvelope): string | undefined {
  const namiContext = task.context?.['nami'];
  if (!namiContext || typeof namiContext !== 'object') return undefined;

  const r = namiContext as Record<string, unknown>;
  const parts: string[] = [];

  if (Array.isArray(r['findings'])) {
    const findings = r['findings'] as Array<{ source?: string; snippet?: string }>;
    for (const f of findings.slice(0, 4)) {
      if (f.source && f.snippet) {
        parts.push(`[${f.source}]\n${f.snippet.substring(0, 500)}`);
      }
    }
  } else if (typeof r['summary'] === 'string' && r['summary']) {
    parts.push(`Repository context: ${r['summary']}`);
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}
