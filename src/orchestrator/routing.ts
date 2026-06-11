import { AgentType } from '../types/messages.js';

export interface RoutingDecision {
  agent: AgentType;
  confidence: number;
  reason: string;
  respondAs?: string;   // crew member the user is specifically addressing
}

const codingKeywords = [
  'code', 'bug', 'debug', 'implement', 'refactor',
  'typescript', 'javascript', 'test', 'function',
  'class', 'api', 'repo', 'error',
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

export function selectSpecialistAgent(userRequest: string): RoutingDecision {
  const normalized = userRequest.toLowerCase();
  const codingScore = countKeywordMatches(normalized, codingKeywords);
  const writingScore = countKeywordMatches(normalized, writingKeywords);
  const respondAs = detectAddressedAgent(userRequest) ?? undefined;

  if (codingScore > writingScore) {
    return {
      agent: 'sanji',
      confidence: Math.min(0.95, 0.55 + codingScore * 0.1),
      reason: 'Request contains code, debugging, implementation, or repository terms.',
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
