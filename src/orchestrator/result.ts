import { AgentResult, AgentType } from '../types/messages.js';
import { RoutingDecision } from './routing.js';

export interface OrchestrationResult {
  taskId: string;
  finalResponse: string;
  selectedAgent: AgentType;
  routing: RoutingDecision;
  specialistResult: AgentResult;
  contextResult?: AgentResult;
}

export function isOrchestrationResult(value: unknown): value is OrchestrationResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return 'finalResponse' in value && typeof (value as { finalResponse?: unknown }).finalResponse === 'string';
}
