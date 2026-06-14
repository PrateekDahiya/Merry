import { LlmClient } from '../llm/client.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'planner' });

export interface TaskPlan {
  subtasks: string[];
  isComplex: boolean;
}

// Conservative prompt — ONLY decompose explicit compound requests.
// Questions, explanations, and greetings are always single-step.
const DECOMPOSE_SYSTEM = `You are a task planner. Decide if a request explicitly asks for multiple SEPARATE outputs.

Return isComplex=true ONLY when the user uses connective words like "and also", "then", "as well as",
"plus", "and additionally" to ask for multiple DISTINCT outputs in a SINGLE message.

ALWAYS return isComplex=false for:
- Questions ("how does", "explain", "what is", "why", "can you tell me")
- Greetings or short messages
- Single-action requests even if complex ("build a REST API", "write a fibonacci function")
- Requests using "and" that describe ONE thing ("build an API with auth" = ONE task)

ONLY return isComplex=true for explicit multi-output requests like:
- "Write a function AND write tests for it AND add documentation" → 3 outputs
- "Explain X, then also show me code for it, and also benchmark it" → 3 outputs

Max 3 subtasks. Each subtask must be a SHORT label (under 10 words), not a sentence.

Return ONLY valid JSON, no markdown:
{"subtasks": [], "isComplex": false}
or
{"subtasks": ["label 1", "label 2"], "isComplex": true}`;

/**
 * Decomposes explicitly compound requests into 2-3 subtasks.
 *
 * Uses ollamaClient if provided (free/local, no quota cost).
 * Falls back to main llm if Ollama is not available.
 * Always returns single-step on any parse error.
 */
export async function decomposeTask(
  request: string,
  llm: LlmClient,
  ollamaClient?: LlmClient,
): Promise<TaskPlan> {
  const plannerLlm = ollamaClient ?? llm;
  try {
    const res = await plannerLlm.chat({
      system: DECOMPOSE_SYSTEM,
      messages: [{ role: 'user', content: request }],
      maxTokens: 200,
    });

    const raw = res.content.replace(/```[a-z]*\n?/gi, '').trim();
    const plan = JSON.parse(raw) as TaskPlan;

    if (!Array.isArray(plan.subtasks) || !plan.isComplex) {
      return { subtasks: [], isComplex: false };
    }

    const subtasks = plan.subtasks
      .map(s => String(s).trim())
      .filter(s => s.length > 3 && s.length < 100)
      .slice(0, 3);  // max 3 subtasks — was 5, now more conservative

    if (subtasks.length < 2) return { subtasks: [], isComplex: false };

    logger.debug({ request: request.slice(0, 80), subtasks }, 'Task decomposition');
    return { subtasks, isComplex: true };
  } catch {
    return { subtasks: [], isComplex: false };  // fail safe: treat as single step
  }
}

/**
 * Assemble results from multiple subtasks into a unified response.
 * Uses the original user request as context header, not the subtask labels.
 */
export function assembleMultiStepResult(subtasks: string[], results: string[]): string {
  if (results.length === 0) return '';
  if (results.length === 1) return results[0]!;

  const parts = subtasks.map((task, i) => {
    const result = results[i] ?? '';
    return `### ${task}\n\n${result}`;
  });

  return parts.join('\n\n---\n\n');
}
