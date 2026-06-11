import { z } from 'zod';

const configSchema = z.object({
  // Telegram
  telegramBotToken: z.string().min(1),
  telegramWebhookSecret: z.string().default('webhook-secret'),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Agent behavior
  agentTimeoutMs: z.number().positive().default(30000),
  agentMaxRetries: z.number().positive().default(3),
  agentRetryDelayMs: z.number().positive().default(1000),

  // Context service
  contextSearchDepth: z.number().positive().default(3),
  contextMaxResults: z.number().positive().default(10),

  // Health monitoring (Tony)
  tonyCheckIntervalMs: z.number().positive().default(5000),
  tonyStuckThresholdMs: z.number().positive().default(60000),

  // Task management
  taskMaxConcurrent: z.number().positive().default(10),
  taskQueueSize: z.number().positive().default(1000),
  taskPersistenceEnabled: z.boolean().default(true),

  // Admin
  adminUserIds: z.string().transform(s => s.split(',').map(x => parseInt(x.trim()))).default(''),

  // Features
  useMockAgents: z.boolean().default(false),
  useMockTelegram: z.boolean().default(false),
  enableAuditLogs: z.boolean().default(true),
  enableTaskInspection: z.boolean().default(true),
});

type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const env = process.env;

  const rawConfig = {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
    agentTimeoutMs: env.AGENT_TIMEOUT_MS ? parseInt(env.AGENT_TIMEOUT_MS) : undefined,
    agentMaxRetries: env.AGENT_MAX_RETRIES ? parseInt(env.AGENT_MAX_RETRIES) : undefined,
    agentRetryDelayMs: env.AGENT_RETRY_DELAY_MS ? parseInt(env.AGENT_RETRY_DELAY_MS) : undefined,
    contextSearchDepth: env.CONTEXT_SEARCH_DEPTH ? parseInt(env.CONTEXT_SEARCH_DEPTH) : undefined,
    contextMaxResults: env.CONTEXT_MAX_RESULTS ? parseInt(env.CONTEXT_MAX_RESULTS) : undefined,
    tonyCheckIntervalMs: env.TONY_CHECK_INTERVAL_MS ? parseInt(env.TONY_CHECK_INTERVAL_MS) : undefined,
    tonyStuckThresholdMs: env.TONY_STUCK_THRESHOLD_MS ? parseInt(env.TONY_STUCK_THRESHOLD_MS) : undefined,
    taskMaxConcurrent: env.TASK_MAX_CONCURRENT ? parseInt(env.TASK_MAX_CONCURRENT) : undefined,
    taskQueueSize: env.TASK_QUEUE_SIZE ? parseInt(env.TASK_QUEUE_SIZE) : undefined,
    taskPersistenceEnabled: env.TASK_PERSISTENCE_ENABLED === 'true',
    adminUserIds: env.ADMIN_USER_IDS,
    useMockAgents: env.USE_MOCK_AGENTS === 'true',
    useMockTelegram: env.USE_MOCK_TELEGRAM === 'true',
    enableAuditLogs: env.ENABLE_AUDIT_LOGS === 'true',
    enableTaskInspection: env.ENABLE_TASK_INSPECTION === 'true',
  };

  return configSchema.parse(rawConfig);
}

export type { Config };
