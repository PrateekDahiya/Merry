import { z } from 'zod';
import { TaskEnvelope } from '../types/messages.js';
import { LlmClient } from '../llm/client.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'specialists' });

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
  requiresApproval: z.boolean().default(false),
  approvalReason: z.string().optional(),
});

export type SpecialistOutput = z.infer<typeof SpecialistOutput>;

export interface SpecialistPromptContext {
  task: TaskEnvelope;
  contextSummary?: string;
}

const ROBIN_SYSTEM = `You are Robin, the writing specialist in a multi-agent orchestration system.
Your role: produce clear, polished, concise natural-language responses.
You MUST respond with a valid JSON object and nothing else:
{
  "title": "short descriptive title",
  "response": "your complete written response",
  "summary": "one sentence summarizing what you did",
  "nextSteps": ["suggested next steps"],
  "warnings": ["any warnings, empty array if none"],
  "requiresApproval": false
}`;

const SANJI_SYSTEM = `You are Sanji, the coding specialist in a multi-agent orchestration system.
Your role: provide precise, implementation-focused technical guidance with code examples.
You MUST respond with a valid JSON object and nothing else:
{
  "title": "short descriptive title",
  "response": "your complete technical response including code",
  "summary": "one sentence summarizing what you did",
  "nextSteps": ["concrete implementation steps"],
  "warnings": ["safety warnings, especially for risky ops"],
  "requiresApproval": false,
  "approvalReason": "reason here if requiresApproval is true, otherwise omit"
}
Set requiresApproval=true for: deleting files/data, dropping databases, mass updates, irreversible changes, production deployments, force-push.`;

const DESTRUCTIVE_KEYWORDS = [
  'delete all',
  'drop table',
  'drop database',
  'truncate',
  'wipe',
  'erase all',
  'rm -rf',
  'format disk',
  'overwrite all',
  'mass update',
  'deploy to production',
  'force push',
  'push to main',
  'push to master',
];

export function buildRobinPrompt({ task, contextSummary }: SpecialistPromptContext): string {
  return [
    `User request: ${task.userRequest}`,
    contextSummary ? `Context:\n${contextSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildSanjiPrompt({ task, contextSummary }: SpecialistPromptContext): string {
  return [
    `User request: ${task.userRequest}`,
    contextSummary ? `Codebase context:\n${contextSummary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function isDestructiveRequest(request: string): boolean {
  const lower = request.toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some(kw => lower.includes(kw));
}

function parseLlmJson(
  raw: string,
  taskId: string,
  specialist: SpecialistKind,
  prompt: string,
): SpecialistOutput {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object in LLM response');
    const parsed = JSON.parse(jsonMatch[0]);
    return SpecialistOutput.parse({ taskId, specialist, prompt, ...parsed });
  } catch (err) {
    logger.warn({ taskId, err: String(err) }, 'LLM JSON parse failed, using plain-text fallback');
    return SpecialistOutput.parse({
      taskId,
      specialist,
      prompt,
      title: specialist === 'robin' ? 'Writing response' : 'Technical response',
      response: raw || `${specialist} could not produce a structured response.`,
      summary: `${specialist} completed the task.`,
      nextSteps: [],
      warnings: [],
      requiresApproval: false,
    });
  }
}

export async function callRobinLlm(
  llm: LlmClient,
  task: TaskEnvelope,
  contextSummary: string | undefined,
): Promise<SpecialistOutput> {
  const prompt = buildRobinPrompt({ task, contextSummary });
  const llmResponse = await llm.chat({
    system: ROBIN_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2048,
  });
  return parseLlmJson(llmResponse.content, task.taskId, 'robin', prompt);
}

export async function callSanjiLlm(
  llm: LlmClient,
  task: TaskEnvelope,
  contextSummary: string | undefined,
): Promise<SpecialistOutput> {
  const prompt = buildSanjiPrompt({ task, contextSummary });
  const llmResponse = await llm.chat({
    system: SANJI_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2048,
  });

  const output = parseLlmJson(llmResponse.content, task.taskId, 'sanji', prompt);

  if (isDestructiveRequest(task.userRequest) && !output.requiresApproval) {
    return {
      ...output,
      requiresApproval: true,
      approvalReason: 'Request contains potentially destructive keywords.',
      warnings: [
        ...output.warnings,
        'This operation was auto-flagged as potentially destructive and requires explicit approval.',
      ],
    };
  }

  return output;
}

export function createRobinOutput(task: TaskEnvelope, prompt: string): SpecialistOutput {
  return SpecialistOutput.parse({
    taskId: task.taskId,
    specialist: 'robin',
    title: 'Writing synthesis',
    response: `Robin response: ${task.userRequest.trim()}.`,
    summary: 'Robin converted the request into a concise editorial response.',
    nextSteps: ['Review tone', 'Check for missing audience constraints', 'Refine wording if needed'],
    warnings: [],
    prompt,
    requiresApproval: false,
  });
}

export function createSanjiOutput(task: TaskEnvelope, prompt: string): SpecialistOutput {
  return SpecialistOutput.parse({
    taskId: task.taskId,
    specialist: 'sanji',
    title: 'Implementation plan',
    response: `Sanji response: implement the request by breaking it into small, testable steps for ${task.userRequest.trim()}.`,
    summary: 'Sanji produced a code-focused response with safety-minded implementation guidance.',
    nextSteps: ['Identify touched files', 'Add tests first', 'Apply changes incrementally'],
    warnings: ['Destructive or broad refactors require Ace approval before execution.'],
    prompt,
    requiresApproval: false,
  });
}
