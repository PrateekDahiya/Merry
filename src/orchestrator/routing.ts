import { AgentType } from '../types/messages.js';
import { LlmClient } from '../llm/client.js';

export interface RoutingDecision {
  agent: AgentType;
  confidence: number;
  reason: string;
  respondAs?: string;   // crew member the user is specifically addressing
}

// ── Valid crew responder names ────────────────────────────────────────────────

const CREW_RESPONDERS = new Set<AgentType>([
  'sanji', 'robin', 'jinbe', 'tony', 'nami', 'zoro', 'brook', 'franky',
]);

function isCrewResponder(s: string): s is AgentType {
  return CREW_RESPONDERS.has(s as AgentType);
}

// ── Keyword fallback (used when LLM classification fails) ────────────────────

interface KeywordDomain {
  agent: AgentType;
  keywords: string[];
}

const KEYWORD_DOMAINS: KeywordDomain[] = [
  {
    agent: 'sanji',
    keywords: [
      'code', 'bug', 'debug', 'implement', 'refactor',
      'typescript', 'javascript', 'python', 'java', 'golang', 'rust',
      'ruby', 'php', 'sql', 'bash', 'shell', 'html', 'css',
      'function', 'class', 'api', 'repo', 'error', 'script', 'program',
      'algorithm', 'snippet', 'method', 'variable', 'loop', 'array',
      'library', 'module', 'package', 'react', 'node', 'django', 'flask',
      'database', 'query', 'terminal', 'command', 'syntax', 'compile', 'runtime',
    ],
  },
  {
    agent: 'jinbe',
    keywords: [
      'fish', 'ocean', 'sea', 'marine', 'coral', 'tide', 'current',
      'sailing', 'whale', 'shark', 'underwater', 'fishman', 'seawater',
      'reef', 'aquatic', 'deep sea', 'nautical', 'vessel', 'waves',
    ],
  },
  {
    agent: 'tony',
    keywords: [
      'health', 'medical', 'medicine', 'doctor', 'disease', 'symptom',
      'treatment', 'biology', 'anatomy', 'virus', 'bacteria', 'illness',
      'cure', 'diagnos', 'prescription', 'injury', 'pain', 'fever',
      'nutrition', 'vitamin', 'diet', 'exercise health',
    ],
  },
  {
    agent: 'nami',
    keywords: [
      'weather', 'temperature', 'forecast', 'climate', 'rain', 'wind',
      'storm', 'humidity', 'map', 'geography', 'navigation', 'route',
      'money', 'budget', 'finance', 'currency', 'cost', 'price',
    ],
  },
  {
    agent: 'zoro',
    keywords: [
      'workout', 'exercise', 'training', 'fitness', 'strength', 'muscle',
      'fight', 'combat', 'sword', 'martial', 'discipline', 'gym', 'cardio',
      'weight', 'pushup', 'pullup', 'stretch', 'flexibility',
    ],
  },
  {
    agent: 'brook',
    keywords: [
      'music', 'song', 'concert', 'album', 'artist', 'band', 'instrument',
      'art', 'painting', 'culture', 'movie', 'film', 'anime', 'manga',
      'entertainment', 'fun', 'joke', 'comedy', 'dance',
    ],
  },
  {
    agent: 'franky',
    keywords: [
      'engineer', 'build', 'construct', 'mechanic', 'robot', 'machine',
      'motor', 'circuit', 'hardware', 'diy', 'repair', 'install',
      'wiring', 'blueprint', 'design', 'fabricat',
    ],
  },
  {
    agent: 'robin',
    keywords: [
      'write', 'edit', 'summarize', 'summary', 'rewrite', 'draft',
      'explain', 'email', 'article', 'history', 'archaeology', 'research',
      'analyse', 'analyze', 'translate', 'document',
    ],
  },
];

/** Maps keywords/phrases to the crew member they refer to (by name). */
const CREW_NAMES: Record<string, string> = {
  'brook': 'brook', 'yohoho': 'brook', 'soul king': 'brook',
  'zoro': 'zoro', 'roronoa': 'zoro',
  'nami': 'nami', 'navigator': 'nami',
  'sanji': 'sanji', 'cook': 'sanji', 'chef': 'sanji',
  'tony': 'tony', 'chopper': 'tony',
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

function keywordRoute(normalized: string, respondAs: string | undefined): RoutingDecision {
  let bestAgent: AgentType = 'robin';
  let bestScore = 0;

  for (const domain of KEYWORD_DOMAINS) {
    const score = domain.keywords.filter(kw => normalized.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestAgent = domain.agent;
    }
  }

  return {
    agent: bestAgent,
    confidence: bestScore > 0 ? Math.min(0.95, 0.55 + bestScore * 0.1) : 0.5,
    reason: bestScore > 0
      ? `Keyword match → ${bestAgent}`
      : 'No keyword domain matched; defaulting to Robin.',
    respondAs,
  };
}

// ── LLM classification ────────────────────────────────────────────────────────

const CREW_CLASSIFIER_SYSTEM = `You are a request router for a crew of One Piece specialists.
Reply with ONE word — the crew member best suited to answer the request.

sanji   — coding, programming, debugging, algorithms, scripts, APIs, CLI, technical how-to
robin   — writing prose, summarizing, explaining concepts, history, research, general knowledge, greetings, small talk
jinbe   — sea, ocean, fish, fishing, marine life, tides, currents, sailing, water
tony    — medical, health, biology, medicine, symptoms, treatment, doctor, anatomy
nami    — weather, climate, temperature, maps, geography, money, budgeting, financial advice
zoro    — training, fitness, fighting, swords, exercise, strength, discipline, martial arts
brook   — music, songs, art, entertainment, movies, culture, anime, manga, fun
franky  — engineering, building, mechanics, construction, DIY, machines, robots, hardware

Reply with ONLY one word: sanji robin jinbe tony nami zoro brook franky`;

async function classifyWithLlm(request: string, llm: LlmClient): Promise<AgentType | null> {
  try {
    const res = await llm.chat({
      system: CREW_CLASSIFIER_SYSTEM,
      messages: [{ role: 'user', content: request }],
      maxTokens: 5,
    });
    const answer = res.content.trim().toLowerCase().split(/\s+/)[0] ?? '';
    if (isCrewResponder(answer)) return answer;
    return null;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Selects the specialist crew member for a user request.
 *
 * Uses LLM classification (single-token response) when an LlmClient is provided,
 * routing to one of 8 crew specialists. Falls back to keyword scoring on LLM failure.
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
        reason: `LLM-classified → ${llmAgent}`,
        respondAs,
      };
    }
  }

  // Keyword fallback
  return keywordRoute(normalized, respondAs);
}
