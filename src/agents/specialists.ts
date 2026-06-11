import { z } from 'zod';
import { TaskEnvelope } from '../types/messages.js';

export const SpecialistKind = z.enum(['robin', 'sanji']);

export type SpecialistKind = z.infer<typeof SpecialistKind>;

export const SpecialistOutput = z.object({
  taskId: z.string(),
  specialist: SpecialistKind,
  title: z.string(),
  response: z.string(),
  summary: z.string(),
  nextSteps: z.array(z.string()),
  warnings: z.array(z.string()),
  prompt: z.string(),
});

export type SpecialistOutput = z.infer<typeof SpecialistOutput>;

export interface SpecialistPromptContext {
  task: TaskEnvelope;
  contextSummary?: string;
}

export function buildRobinPrompt({ task, contextSummary }: SpecialistPromptContext): string {
  return [
    'You are Robin, the writing specialist.',
    'Your job is to produce clear, polished, concise natural-language output.',
    `User request: ${task.userRequest}`,
    contextSummary ? `Context summary: ${contextSummary}` : 'Context summary: none',
    'Return output that is reader-friendly and direct.',
  ].join('\n');
}

export function buildSanjiPrompt({ task, contextSummary }: SpecialistPromptContext): string {
  return [
    'You are Sanji, the coding specialist.',
    'Your job is to propose implementation-oriented, precise, code-focused guidance.',
    `User request: ${task.userRequest}`,
    contextSummary ? `Context summary: ${contextSummary}` : 'Context summary: none',
    'Return output that is technical, actionable, and safety-aware.',
  ].join('\n');
}

export function createRobinOutput(task: TaskEnvelope, prompt: string): SpecialistOutput {
  const response = `Robin response: ${task.userRequest.trim()}.`;

  return SpecialistOutput.parse({
    taskId: task.taskId,
    specialist: 'robin',
    title: 'Writing synthesis',
    response,
    summary: 'Robin converted the request into a concise editorial response.',
    nextSteps: ['Review tone', 'Check for missing audience constraints', 'Refine wording if needed'],
    warnings: [],
    prompt,
  });
}

export function createSanjiOutput(task: TaskEnvelope, prompt: string): SpecialistOutput {
  const response = `Sanji response: implement the request by breaking it into small, testable steps for ${task.userRequest.trim()}.`;

  return SpecialistOutput.parse({
    taskId: task.taskId,
    specialist: 'sanji',
    title: 'Implementation plan',
    response,
    summary: 'Sanji produced a code-focused response with safety-minded implementation guidance.',
    nextSteps: ['Identify touched files', 'Add tests first', 'Apply changes incrementally'],
    warnings: ['Destructive or broad refactors require Ace approval before execution.'],
    prompt,
  });
}
