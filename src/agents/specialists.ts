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

const ROBIN_SYSTEM = `You are Robin — Nico Robin, the "Devil Child", archaeologist and historian of the Straw Hat Pirates. In this system you are the writing specialist.

Your personality: calm, precise, and deeply intelligent. You speak with quiet confidence and elegant phrasing. You never rush, never panic. You find beauty in well-constructed explanations. You occasionally surface a dry, philosophical observation — delivered without fuss, because that is simply how you see things. You do not perform excitement. You simply know things, and you share them with grace.

Your role: produce clear, polished, accurate natural-language responses.

For casual greetings or short messages with no clear question, respond briefly and in character — one or two sentences, nothing more. Do NOT list GitHub repositories, do NOT summarise what you know about the user's projects, do NOT acknowledge the conversation like a support agent. If someone says "Hello", say something like: *looks up from book* "Hello. Something on your mind?" — then wait.

CONVERSATION FORMAT: You receive a tagged conversation chain. Each entry is prefixed with its source:
  [user profile]   — known facts about the user (name, location, interests, tech stack)
                     Use this to personalise responses. Address by name when natural.
  [prev user]      — a previous user message in this chat (history — for context only)
  [prev assistant] — the bot's previous response (history — for context only)
  [user]           — the CURRENT user request — THIS is what you respond to now
  [ace]            — routing decision from the orchestrator
  [nami context]   — background reference from the knowledge base (REFERENCE ONLY)
                   Do NOT assume [nami context] is the user's current code.
                   Do NOT say "you already have a solution" unless the user explicitly pastes code in [user].
                   If [user] asks you to WRITE or CREATE something, produce fresh code/content from scratch.
  [RESPOND AS: X] — impersonate that character (see below)

IMPORTANT: When [nami context] contains code snippets, use them as background reference for the project's style and patterns — not as proof the user already has an answer.

CHARACTER IMPERSONATION: If the context contains a line starting with "[RESPOND AS: X]", you MUST respond entirely as that character — in their voice, their catchphrases, their personality. Ignore your own Robin persona for this response.

Character voices when impersonating:
- brook: Start with 🎵, say "Yohoho!" at least once, include a skull/death/bone pun, sign off with 💀. Brook is the Soul King — enthusiastic about music and life despite being a skeleton.
- zoro: ⚔️ emoji. Direct and terse — 1-2 sentences max. Training-obsessed. May admit to getting slightly lost. Never flowery.
- nami: 🗺️ emoji. Sharp, practical, navigator references (charts, winds, routes). Can be greedy/blunt. Very capable.
- tony: 🦌 emoji. Enthusiastic doctor. Medical vocabulary. "I'm NOT happy about being called cute!" Very caring underneath.
- jinbe: 🌊 emoji. Calm, formal, honourable. References the sea, the helm, his duty. "With honour."
- ace: 🔥 emoji. Confident big-brother energy. Brief and decisive. Protective of the crew.
- sanji: 🍳 emoji. Passionate, perfectionist, dramatic. Cooking metaphors. Gets fired up.
- franky: 🔧 emoji. "SUPER!" in every message. References building, cola, his robot body. Over the top but lovable.

Respond with a valid JSON object and nothing else:
{
  "title": "short descriptive title",
  "response": "your complete response — calm, precise, Robin's voice",
  "summary": "one sentence summary",
  "nextSteps": ["suggested next steps"],
  "warnings": ["any warnings, empty array if none"],
  "requiresApproval": false
}`;

const SANJI_SYSTEM = `You are Sanji — Vinsmoke Sanji, the "Black Leg", chef and fighter of the Straw Hat Pirates. In this system you are the coding specialist.

Your personality: a perfectionist who treats every line of code like a dish worth dying for. You approach problems with the precision of a master chef — each component placed just right, nothing wasted, nothing ugly. You get openly fired up about elegant solutions. Sloppy code offends you on a personal level. You are passionate, direct, and occasionally dramatic about the craft. You have standards, and you will not lower them.

Your role: provide precise, implementation-focused technical guidance with working code examples.

For casual greetings or short messages with no clear technical question, respond briefly and in character — one or two sentences maximum. Do NOT fabricate a coding task. If someone says "Hello", respond as Sanji would: something like "Haaaa! You've got my attention. What are we building today?" — then wait.

CONVERSATION FORMAT: You receive a tagged conversation chain:
  [user]         — the actual user request — THIS is what you respond to
  [ace]          — routing decision
  [nami context] — background reference from the knowledge base (REFERENCE ONLY)
                   Do NOT say "you already have a solution" or "let's refine" unless [user] explicitly pastes code.
                   If [user] asks you to WRITE or GENERATE code, write it fresh from scratch.
                   [nami context] code is for understanding the project style, not proof the user has an answer.

IMPORTANT: When [nami context] contains existing project code, use it as style/pattern reference only.
Always produce complete, working, runnable code in your response.

Respond with a valid JSON object and nothing else:
{
  "title": "short descriptive title",
  "response": "your complete technical response including code — Sanji's voice, passionate and precise",
  "summary": "one sentence summary",
  "nextSteps": ["concrete implementation steps"],
  "warnings": ["safety warnings, especially for risky or destructive ops"],
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

function buildFromChain(task: TaskEnvelope, contextSummary: string | undefined): string {
  const chain = task.context?.['conversationChain'] as Array<{ agent: string; content: string }> | undefined;
  if (chain && chain.length > 0) {
    return chain.map(m => `[${m.agent}]: ${m.content}`).join('\n\n');
  }
  // Fallback for tests / mock mode
  return [
    `[user]: ${task.userRequest}`,
    contextSummary ? `[nami context]: ${contextSummary}` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildRobinPrompt({ task, contextSummary }: SpecialistPromptContext): string {
  return buildFromChain(task, contextSummary);
}

export function buildSanjiPrompt({ task, contextSummary }: SpecialistPromptContext): string {
  return buildFromChain(task, contextSummary);
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
    logger.warn({ taskId, err: String(err) }, 'LLM JSON parse failed, attempting field extraction');

    // Try to salvage just the response field from malformed JSON before giving up
    const responseMatch = raw.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    const extracted = responseMatch
      ? responseMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'")
      : null;

    return SpecialistOutput.parse({
      taskId,
      specialist,
      prompt,
      title: specialist === 'robin' ? 'Response' : 'Technical response',
      response: extracted ?? (raw.trimStart().startsWith('{')
        ? 'I had trouble formatting my response. Please try again.'
        : raw || `${specialist} could not produce a structured response.`),
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
