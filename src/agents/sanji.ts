import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { SpecialistOutput, buildSanjiPrompt, createSanjiOutput } from './specialists.js';

/**
 * Sanji - Coding Agent
 *
 * Responsibilities:
 * - Implementation and code generation
 * - Debugging and troubleshooting
 * - Refactoring
 * - Code-specific tasks
 * - Safe approval/checkpoint mechanism for risky changes
 *
 * Phase 5 implements a dedicated coding specialist contract.
 */
export class SanjiAgent extends BaseAgent {
  constructor() {
    super('sanji-primary', 'sanji');
  }

  protected async doWork(task: TaskEnvelope): Promise<SpecialistOutput> {
    const prompt = buildSanjiPrompt({
      task,
      contextSummary: summarizeTaskContext(task),
    });

    this.logger.info(
      { taskId: task.taskId, promptType: 'coding', promptLength: prompt.length },
      'Sanji processing coding task'
    );

    return createSanjiOutput(task, prompt);
  }
}

function summarizeTaskContext(task: TaskEnvelope): string | undefined {
  const context = task.context;

  if (!context) {
    return undefined;
  }

  const keys = Object.keys(context);
  if (keys.length === 0) {
    return undefined;
  }

  return keys
    .map(key => `${key}: ${stringifyContextValue(context[key])}`)
    .join('; ');
}

function stringifyContextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => stringifyContextValue(item)).join(', ');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
