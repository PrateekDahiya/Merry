import { AgentType } from '../types/messages.js';

export interface RoutingDecision {
  agent: AgentType;
  confidence: number;
  reason: string;
}

const codingKeywords = [
  'code',
  'bug',
  'debug',
  'implement',
  'refactor',
  'typescript',
  'javascript',
  'test',
  'function',
  'class',
  'api',
  'repo',
  'error',
];

const writingKeywords = [
  'write',
  'edit',
  'summarize',
  'summary',
  'rewrite',
  'draft',
  'explain',
  'email',
  'article',
  'copy',
  'tone',
];

function countKeywordMatches(text: string, keywords: string[]): number {
  return keywords.filter(keyword => text.includes(keyword)).length;
}

export function selectSpecialistAgent(userRequest: string): RoutingDecision {
  const normalized = userRequest.toLowerCase();
  const codingScore = countKeywordMatches(normalized, codingKeywords);
  const writingScore = countKeywordMatches(normalized, writingKeywords);

  if (codingScore > writingScore) {
    return {
      agent: 'sanji',
      confidence: Math.min(0.95, 0.55 + codingScore * 0.1),
      reason: 'Request contains code, debugging, implementation, or repository terms.',
    };
  }

  if (writingScore > 0) {
    return {
      agent: 'robin',
      confidence: Math.min(0.95, 0.55 + writingScore * 0.1),
      reason: 'Request contains writing, editing, summarization, or prose terms.',
    };
  }

  return {
    agent: 'robin',
    confidence: 0.5,
    reason: 'No specialist keyword dominated; Robin is the default general response specialist.',
  };
}
