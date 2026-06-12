import { AgentType } from '../types/messages.js';
import { LlmClient } from '../llm/client.js';

export interface RoutingDecision {
  agent: AgentType;
  confidence: number;
  reason: string;
  respondAs?: string;   // crew member the user is specifically addressing
}

// ── Keyword fallback (used when LLM classification fails) ────────────────────

const codingKeywords = [
  'code', 'bug', 'debug', 'implement', 'refactor',
  'typescript', 'javascript', 'python', 'java', 'golang', 'rust',
  'ruby', 'php', 'sql', 'bash', 'shell', 'html', 'css',
  'test', 'function', 'class', 'api', 'repo', 'error',
  'script', 'program', 'algorithm', 'snippet', 'method',
  'variable', 'loop', 'array', 'library', 'module', 'package',
  'react', 'node', 'django', 'flask', 'database', 'query',
  'terminal', 'command', 'syntax', 'compile', 'runtime',
];

const writingKeywords = [
  'write', 'edit', 'summarize', 'summary', 'rewrite',
  'draft', 'explain', 'email', 'article', 'copy', 'tone',
];

/** Maps keywords/phrases to the crew member they refer to. */
const CREW_NAMES: Record<string, string> = {
  'brook': 'brook', 'yohoho': 'brook', 'soul king': 'brook',
  'zoro': 'zoro', 'roronoa': 'zoro',
  'nami': 'nami', 'navigator': 'nami',
  'sanji': 'sanji', 'cook': 'sanji', 'chef': 'sanji',
  'tony': 'tony', 'chopper': 'tony', 'doctor': 'tony',
  'robin': 'robin', 'nico': 'robin',
  'jinbe': 'jinbe', 'helmsman': 'jinbe',
  'ace': 'ace', 'fire fist': 'ace',
  'franky': 'franky',
};

function detectAddressedAgent(request: string): string | null {
  const lower = request.toLowerCase();
  for (const [keyword, agent] of Object.entries(CREW_NAMES)) {
    if (lower.includes(keyword)) return agent;
  }
  return null;
}

function countKeywordMatches(text: string, keywords: string[]): number {
  return keywords.filter(keyword => text.includes(keyword)).length;
}

function keywordRoute(normalized: string, respondAs: string | undefined): RoutingDecision {
  const codingScore = countKeywordMatches(normalized, codingKeywords);
  const writingScore = countKeywordMatches(normalized, writingKeywords);

  // Tie goes to Sanji — "write code" is a coding request, not a writing request
  if (codingScore > 0 && codingScore >= writingScore) {
    return {
      agent: 'sanji',
      confidence: Math.min(0.95, 0.55 + codingScore * 0.1),
      reason: 'Request contains code, programming, or technical implementation terms.',
      respondAs,
    };
  }

  if (writingScore > 0) {
    return {
      agent: 'robin',
      confidence: Math.min(0.95, 0.55 + writingScore * 0.1),
      reason: 'Request contains writing, editing, summarization, or prose terms.',
      respondAs,
    };
  }

  return {
    agent: 'robin',
    confidence: 0.5,
    reason: 'No specialist keyword dominated; Robin is the default general response specialist.',
    respondAs,
  };
}

// ── LLM classification ────────────────────────────────────────────────────────

const CLASSIFIER_SYSTEM = `You are a request router for a two-specialist system.
Decide which specialist should handle the user request:

"sanji" — for: writing/generating code, debugging, implementing features, algorithms,
  programming languages (Python, JavaScript, Java, Rust, SQL, Bash, etc.), scripts,
  technical how-to, CLI commands, API usage, data structures, compiling, runtime errors

"robin" — for: writing prose, summarizing text, explaining non-technical concepts,
  editing documents, drafting emails/articles, answering general knowledge questions,
  creative writing, translations

Reply with ONLY one word: sanji or robin`;

async function classifyWithLlm(request: string, llm: LlmClient): Promise<'sanji' | 'robin' | null> {
  try {
    const res = await llm.chat({
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: 'user', content: request }],
      maxTokens: 5,
    });
    const answer = res.content.trim().toLowerCase().split(/\s+/)[0] ?? '';
    if (answer === 'sanji' || answer === 'robin') return answer;
    return null;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Selects the specialist agent for a user request.
 *
 * Uses LLM classification (single-token response) when an LlmClient is provided.
 * Falls back to keyword scoring if the LLM is unavailable or returns unexpected output.
 *
 * Call this in parallel with Nami's context search so it adds zero latency:
 *   const [contextResult, routing] = await Promise.all([requestContext(task), selectSpecialistAgent(req, llm)])
 */
export async function selectSpecialistAgent(
  userRequest: string,
  llm?: LlmClient,
): Promise<RoutingDecision> {
  const respondAs = detectAddressedAgent(userRequest) ?? undefined;
  const normalized = userRequest.toLowerCase();

  if (llm) {
    const llmAgent = await classifyWithLlm(userRequest, llm);
    if (llmAgent) {
      return {
        agent: llmAgent,
        confidence: 0.9,
        reason: `LLM-classified as ${llmAgent === 'sanji' ? 'coding' : 'writing'} request.`,
        respondAs,
      };
    }
  }

  // Keyword fallback
  return keywordRoute(normalized, respondAs);
}
