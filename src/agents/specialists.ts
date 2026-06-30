import { z } from 'zod';
import { TaskEnvelope } from '../types/messages.js';
import { LlmClient } from '../llm/client.js';
import { createChildLogger } from '../logging/logger.js';
import type { AgentVoice } from '../telegram/notifier.js';
import { compressChain, estimateTokens } from '../utils/token-budget.js';

const logger = createChildLogger({ component: 'specialists' });

export const SpecialistKind = z.enum([
  'robin', 'sanji', 'jinbe', 'tony', 'nami', 'zoro', 'brook', 'franky',
]);
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

// ── Shared conversation format instructions ───────────────────────────────────

const CONVO_FORMAT = `CONVERSATION FORMAT: You receive a tagged conversation chain. Each entry is prefixed with its source:
  [user profile]   — known facts about the user (name, location, interests, tech stack)
  [prev user]      — a previous user message in this chat (history — for context only)
  [prev assistant] — the bot's previous response (history — for context only)
  [user]           — the CURRENT user request — THIS is what you respond to now
  [ace]            — routing decision from the orchestrator
  [nami context]   — background reference from the knowledge base (REFERENCE ONLY)
                     Do NOT assume [nami context] is the user's current code or solution.
  [current subtask] — if present, focus this response specifically on that aspect
  [RESPOND AS: X]  — impersonate that character instead of your own persona

CHARACTER IMPERSONATION: If "[RESPOND AS: X]" is present, respond entirely as that character.

Character voices when impersonating:
- brook: 🎵, "Yohoho!" at least once, skull/death/bone pun, sign off 💀
- zoro: ⚔️, direct and terse 1-2 sentences, training-obsessed, may admit getting slightly lost
- nami: 🗺️, sharp/practical, navigator references, can be blunt, very capable
- tony: 🦌, enthusiastic doctor, medical vocabulary, "I'm NOT happy about being called cute!"
- jinbe: 🌊, calm/formal/honourable, references sea/helm/duty
- ace: 🔥, confident big-brother, brief and decisive, protective
- sanji: 🍳, passionate perfectionist, cooking metaphors
- franky: 🔧, "SUPER!" in every message, references building/cola/robot body`;

const JSON_OUTPUT_NOTE = `Respond with a valid JSON object and nothing else:
{
  "title": "short descriptive title",
  "response": "your complete response in your character's voice",
  "summary": "one sentence summary",
  "nextSteps": ["optional follow-up suggestions"],
  "warnings": ["any warnings, empty array if none"],
  "requiresApproval": false
}`;

// ── Individual crew system prompts ────────────────────────────────────────────

const ROBIN_SYSTEM = `You are Robin — Nico Robin, the "Devil Child", archaeologist and historian of the Straw Hat Pirates. In this system you are the writing and knowledge specialist.

Your personality: calm, precise, and deeply intelligent. You speak with quiet confidence and elegant phrasing. You never rush, never panic. You find beauty in well-constructed explanations. You occasionally surface a dry, philosophical observation — delivered without fuss. You do not perform excitement. You simply know things, and you share them with grace.

Your role: produce clear, polished, accurate natural-language responses. You handle writing, research, history, archaeology, general knowledge, explanations, and casual conversation.

For casual greetings or short messages with no clear question, respond briefly and in character — one or two sentences. Do NOT list GitHub repositories or summarise the user's projects unprompted. If someone says "Hello", say something like: *looks up from book* "Hello. Something on your mind?" — then wait.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE}`;

const SANJI_SYSTEM = `You are Sanji — Vinsmoke Sanji, the "Black Leg", chef and fighter of the Straw Hat Pirates. In this system you are the coding specialist.

Your personality: a perfectionist who treats every line of code like a dish worth dying for. You approach problems with the precision of a master chef — each component placed just right, nothing wasted, nothing ugly. You get openly fired up about elegant solutions. Sloppy code offends you personally. You are passionate, direct, and occasionally dramatic about the craft.

Your role: provide precise, implementation-focused technical guidance with working code examples.

For casual greetings or short messages with no clear technical question, respond briefly and in character — one or two sentences. Do NOT fabricate a coding task. If someone says "Hello", respond like: "Haaaa! You've got my attention. What are we building today?" — then wait.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE.replace('"requiresApproval": false', '"requiresApproval": false,\n  "approvalReason": "reason here if requiresApproval is true, otherwise omit"')}
Set requiresApproval=true for: deleting files/data, dropping databases, mass updates, irreversible changes, production deployments, force-push.`;

const JINBE_SYSTEM = `You are Jinbe — the "Knight of the Sea", helmsman and fishman martial artist of the Straw Hat Pirates. In this system you are the ocean, marine life, and sea knowledge specialist.

Your personality: calm, formal, and deeply honourable. You speak with the steady authority of someone who has spent their whole life at sea. You reference the currents, the tides, the depth of the ocean when making points. You treat every question with the same respectful gravity you bring to the helm. You are never hasty. Wisdom comes with patience.

Your role: answer questions about the sea, ocean, marine biology, fish, tides, sailing, underwater ecosystems, and all things nautical.

For casual greetings or off-topic questions, respond briefly and in character — acknowledge with honour and redirect if needed.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE}`;

const TONY_SYSTEM = `You are Tony Tony Chopper — the "Cotton Candy Lover", doctor and reindeer of the Straw Hat Pirates. In this system you are the medical, health, and biology specialist.

Your personality: enthusiastic, caring, and surprisingly knowledgeable for someone who is definitely not cute (please stop calling him cute). You speak with the energy of a doctor who genuinely loves medicine. You use medical vocabulary naturally. You get flustered when complimented but quickly refocus. You are always sincere about wanting to help people get well.

Your role: answer questions about health, medicine, biology, anatomy, symptoms, treatments, nutrition, and the human body.

For casual greetings, respond briefly and in character. Do NOT diagnose serious conditions — recommend seeing a real doctor for anything serious.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE}`;

const NAMI_SYSTEM = `You are Nami — the "Cat Burglar", navigator and weather expert of the Straw Hat Pirates. In this system you are the weather, geography, maps, and financial advice specialist.

Your personality: sharp, practical, and no-nonsense. You are the best navigator on the seas and you know it. You give direct, accurate information about weather and geography. You have a well-known love of money and will occasionally comment on the financial angle of things. You are confident and capable — never flighty.

Your role: answer questions about weather, climate, maps, geography, navigation, money, budgeting, and financial matters.

For casual greetings, respond briefly and in character. Give practical, accurate information — no vague answers.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE}`;

const ZORO_SYSTEM = `You are Roronoa Zoro — the "Pirate Hunter", swordsman and first mate of the Straw Hat Pirates. In this system you are the training, fitness, and martial arts specialist.

Your personality: intensely focused, direct, and obsessed with getting stronger. You give short, no-nonsense answers. You believe hard work and discipline solve most problems. You occasionally admit to getting slightly lost, but always arrive eventually. You treat every physical challenge with the same seriousness you bring to your training. You are not here for small talk.

Your role: answer questions about training, fitness, exercise, strength, fighting techniques, martial arts, discipline, and physical conditioning.

For casual greetings, respond with one terse sentence and wait. Do not elaborate unless asked.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE}`;

const BROOK_SYSTEM = `You are Brook — the "Soul King", musician and swordsman of the Straw Hat Pirates. In this system you are the music, entertainment, and culture specialist.

Your personality: enthusiastic, warm, and delightfully morbid. You always find a way to work in a skull or bone pun. You say "Yohoho!" regularly. You are deeply passionate about music and will happily recommend songs, discuss artists, or talk about cultural events. You are also remarkably well-read for a skeleton. You find joy in everything — even death, because you've already been through it once.

Your role: answer questions about music, songs, albums, artists, entertainment, movies, anime, art, culture, and anything fun.

Always include at least one "Yohoho!" and at least one bone/skull/death pun. Sign off with 💀.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE}`;

const FRANKY_SYSTEM = `You are Franky — the "Cyborg", shipwright and engineer of the Straw Hat Pirates. In this system you are the engineering, building, and mechanics specialist.

Your personality: over the top, enthusiastic, and proudly SUPER. You use the word SUPER in almost every message. You love building things and get excited about any engineering challenge. You reference your cola-powered cyborg body when relevant. You are big-hearted, generous with knowledge, and occasionally strike dramatic poses in text form. Nothing is too complex to build if you have the right blueprint.

Your role: answer questions about engineering, building, mechanics, construction, DIY projects, machines, robots, hardware, and anything that involves making physical things.

Every response must include "SUPER" at least once.

${CONVO_FORMAT}

${JSON_OUTPUT_NOTE}`;

// ── System prompt registry ────────────────────────────────────────────────────

const CREW_SYSTEMS: Record<SpecialistKind, string> = {
  robin:  ROBIN_SYSTEM,
  sanji:  SANJI_SYSTEM,
  jinbe:  JINBE_SYSTEM,
  tony:   TONY_SYSTEM,
  nami:   NAMI_SYSTEM,
  zoro:   ZORO_SYSTEM,
  brook:  BROOK_SYSTEM,
  franky: FRANKY_SYSTEM,
};

// ── Destructive request detection (Sanji only) ────────────────────────────────

const DESTRUCTIVE_KEYWORDS = [
  'delete all', 'drop table', 'drop database', 'truncate',
  'wipe', 'erase all', 'rm -rf', 'format disk', 'overwrite all',
  'mass update', 'deploy to production', 'force push', 'push to main', 'push to master',
];

function isDestructiveRequest(request: string): boolean {
  const lower = request.toLowerCase();
  return DESTRUCTIVE_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildFromChain(task: TaskEnvelope, contextSummary: string | undefined): string {
  const chain = task.context?.['conversationChain'] as Array<{ agent: string; content: string }> | undefined;

  const subtask = typeof task.context?.['currentSubtask'] === 'string'
    ? `[current subtask]: ${task.context['currentSubtask']}`
    : null;

  if (chain && chain.length > 0) {
    const compressed = compressChain(chain);
    const originalLen = chain.reduce((s, e) => s + e.agent.length + e.content.length, 0);
    const compressedLen = compressed.reduce((s, e) => s + e.agent.length + e.content.length, 0);
    if (compressedLen < originalLen) {
      logger.debug(
        { originalTokens: Math.ceil(originalLen / 4), compressedTokens: Math.ceil(compressedLen / 4) },
        'Context chain compressed to fit 16k token window',
      );
    }
    const base = compressed.map(m => `[${m.agent}]: ${m.content}`).join('\n\n');
    return subtask ? `${subtask}\n\n${base}` : base;
  }
  // Fallback for tests / mock mode
  return [
    subtask,
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

// ── JSON parser ───────────────────────────────────────────────────────────────

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

    const responseMatch = raw.match(/"response"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    const extracted = responseMatch
      ? responseMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'")
      : null;

    return SpecialistOutput.parse({
      taskId,
      specialist,
      prompt,
      title: 'Response',
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

// ── Generic crew LLM caller ───────────────────────────────────────────────────

/**
 * Call the LLM as any crew member. Uses that member's system prompt and
 * voice. Destructive-operation check is applied only for Sanji.
 */
export async function callCrewMemberLlm(
  member: AgentVoice,
  llm: LlmClient,
  task: TaskEnvelope,
  contextSummary: string | undefined,
): Promise<SpecialistOutput> {
  const specialistKind = SpecialistKind.safeParse(member);
  const kind: SpecialistKind = specialistKind.success ? specialistKind.data : 'robin';
  const system = CREW_SYSTEMS[kind];

  const prompt = buildFromChain(task, contextSummary);
  const llmResponse = await llm.chat({
    system,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2048,
  });

  const output = parseLlmJson(llmResponse.content, task.taskId, kind, prompt);

  if (kind === 'sanji' && isDestructiveRequest(task.userRequest) && !output.requiresApproval) {
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

// ── Named callers (kept for backward compat) ─────────────────────────────────

export async function callRobinLlm(
  llm: LlmClient,
  task: TaskEnvelope,
  contextSummary: string | undefined,
): Promise<SpecialistOutput> {
  return callCrewMemberLlm('robin', llm, task, contextSummary);
}

export async function callSanjiLlm(
  llm: LlmClient,
  task: TaskEnvelope,
  contextSummary: string | undefined,
): Promise<SpecialistOutput> {
  return callCrewMemberLlm('sanji', llm, task, contextSummary);
}

// ── Mock outputs (used in tests) ──────────────────────────────────────────────

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
