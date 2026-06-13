import { LlmClient } from '../llm/client.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'planner' });

export interface TaskPlan {
  subtasks: string[];
  isComplex: boolean;
}

const DECOMPOSE_SYSTEM = `You are a task planner. Decide if a request needs multiple steps.
If simple (1 step), return: {"subtasks": [], "isComplex": false}
If complex (2-5 steps), return: {"subtasks": ["step 1", "step 2", ...], "isComplex": true}

Examples of COMPLEX (multi-step):
- "Build a REST API with auth, tests, and documentation" → 3+ steps
- "Write code AND explain it AND write tests for it" → 3 steps
- "Refactor this AND update the docs AND add error handling" → 3 steps

Examples of SIMPLE (single step):
- "Write a fibonacci function" → single step
- "Explain quicksort" → single step
- "Fix this bug" → single step

Return ONLY valid JSON. No markdown, no explanation.`;

/**
 * Decomposes a complex request into 2-5 subtasks.
 * Returns subtasks array (empty if request is simple/single-step).
 * Falls back to empty array (single step) on any error.
 */
export async function decomposeTask(request: string, llm: LlmClient): Promise<TaskPlan> {
  try {
    const res = await llm.chat({
      system: DECOMPOSE_SYSTEM,
      messages: [{ role: 'user', content: request }],
      maxTokens: 300,
    });

    const raw = res.content.replace(/```[a-z]*\n?/gi, '').trim();
    const plan = JSON.parse(raw) as TaskPlan;

    if (!Array.isArray(plan.subtasks)) {
      return { subtasks: [], isComplex: false };
    }

    const subtasks = plan.subtasks
      .map(s => String(s).trim())
      .filter(s => s.length > 5)
      .slice(0, 5);  // max 5 subtasks

    logger.debug({ request: request.slice(0, 80), subtasks }, 'Task decomposition');
    return { subtasks, isComplex: plan.isComplex && subtasks.length > 1 };
  } catch {
    return { subtasks: [], isComplex: false };  // fail safe: treat as single step
  }
}

/**
 * Assemble results from multiple subtasks into a unified response.
 */
export function assembleMultiStepResult(subtasks: string[], results: string[]): string {
  if (results.length === 0) return '';
  if (results.length === 1) return results[0]!;

  const parts = subtasks.map((task, i) => {
    const result = results[i] ?? '';
    return `### Step ${i + 1}: ${task}\n\n${result}`;
  });

  return parts.join('\n\n---\n\n');
}
