import { randomBytes } from 'crypto';

/**
 * Utility functions for generating IDs and identifiers.
 */

/**
 * Generate a unique task ID.
 */
export function generateTaskId(): string {
  return `task-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

/**
 * Generate a unique agent instance ID.
 */
export function generateAgentInstanceId(agentType: string): string {
  return `${agentType}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

/**
 * Generate a unique run ID for tracking execution.
 */
export function generateRunId(): string {
  return `run-${Date.now()}-${randomBytes(4).toString('hex')}`;
}
