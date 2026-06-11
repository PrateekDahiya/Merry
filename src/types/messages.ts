import { z } from 'zod';

/**
 * Shared message types and contracts for inter-agent communication.
 * These schemas ensure all agent-to-agent messaging is structured and validated.
 */

// Task lifecycle states
export const TaskState = z.enum([
  'received',
  'acknowledged',
  'delegated',
  'running',
  'waiting_for_context',
  'awaiting_approval',
  'completed',
  'failed',
  'stuck',
  'escalated',
  'cancelled',
]);

export type TaskState = z.infer<typeof TaskState>;

// Agent types
export const AgentType = z.enum([
  'ace', // Master orchestrator
  'tom', // Telegram interface
  'robin', // Writing agent
  'sanji', // Coding agent
  'nami', // Context agent
  'tony', // Watchdog agent
]);

export type AgentType = z.infer<typeof AgentType>;

// Core task envelope
export const TaskEnvelope = z.object({
  taskId: z.string(),
  chatId: z.string(),
  userId: z.string(),
  messageId: z.string(),
  timestamp: z.date(),
  state: TaskState,
  userRequest: z.string(),
  assignedAgent: AgentType.optional(),
  context: z.record(z.unknown()).optional(),
  constraints: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type TaskEnvelope = z.infer<typeof TaskEnvelope>;

// Agent result wrapper
export const AgentResult = z.object({
  taskId: z.string(),
  agentId: z.string(),
  success: z.boolean(),
  result: z.unknown(),
  error: z.string().optional(),
  executionTimeMs: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type AgentResult = z.infer<typeof AgentResult>;

// Context response from Nami
export const ContextResponse = z.object({
  taskId: z.string(),
  findings: z.array(
    z.object({
      source: z.string(),
      snippet: z.string(),
      relevance: z.number().min(0).max(1),
    })
  ),
  summary: z.string(),
  timestamp: z.date(),
});

export type ContextResponse = z.infer<typeof ContextResponse>;

// Health status report from Tony
export const HealthReport = z.object({
  reportedAt: z.date(),
  agentStatuses: z.record(
    z.object({
      healthy: z.boolean(),
      lastHeartbeat: z.date(),
      activeTaskCount: z.number(),
      errorCount: z.number().optional(),
      message: z.string().optional(),
    })
  ),
  queueHealth: z.object({
    pendingTasks: z.number(),
    stalledTasks: z.array(z.string()),
    averageQueueTimeMs: z.number(),
  }),
  recommendations: z.array(z.string()),
});

export type HealthReport = z.infer<typeof HealthReport>;

// Telegram message metadata
export const TelegramMessageMeta = z.object({
  chatId: z.number(),
  messageId: z.number(),
  userId: z.number(),
  username: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  timestamp: z.date(),
  text: z.string(),
  isReply: z.boolean().default(false),
  replyToMessageId: z.number().optional(),
});

export type TelegramMessageMeta = z.infer<typeof TelegramMessageMeta>;
