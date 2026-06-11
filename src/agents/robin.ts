import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { SpecialistOutput, buildRobinPrompt, createRobinOutput } from './specialists.js';

/**
 * Robin - Writing Agent
 *
 * Responsibilities:
 * - Writing and editing content
 * - Summarization
 * - Natural language response generation
 * - Formatting and structuring text output
 *
 * Phase 5 implements a dedicated writing specialist contract.
 */
export class RobinAgent extends BaseAgent {
  constructor() {
    super('robin-primary', 'robin');
  }

  protected async doWork(task: TaskEnvelope): Promise<SpecialistOutput> {
    const prompt = buildRobinPrompt({
      task,
      contextSummary: summarizeTaskContext(task),
    });

    this.logger.info(
      { taskId: task.taskId, promptType: 'writing', promptLength: prompt.length },
      'Robin processing writing task'
    );

    return createRobinOutput(task, prompt);
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
