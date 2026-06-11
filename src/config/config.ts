import { z } from 'zod';

const optionalBoolean = z.preprocess(value => {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}, z.boolean());

const configSchema = z.object({
  // Telegram
  telegramBotToken: z.string().min(1),
  telegramWebhookSecret: z.string().default('webhook-secret'),

  // LLM provider selection
  llmProvider: z.enum(['groq', 'anthropic', 'mock']).optional(),

  // Groq
  groqApiKey: z.string().optional(),
  groqModel: z.string().default('llama-3.3-70b-versatile'),

  // Anthropic Claude (alternative)
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().default('claude-sonnet-4-6'),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Agent behavior
  agentTimeoutMs: z.number().positive().default(30000),
  agentMaxRetries: z.number().positive().default(3),
  agentRetryDelayMs: z.number().positive().default(1000),

  // Context service
  contextRootDir: z.string().optional(),
  contextSearchDepth: z.number().positive().default(3),
  contextMaxResults: z.number().positive().default(10),

  // GitHub context source
  githubToken: z.string().optional(),
  githubUsername: z.string().optional(),
  githubMaxResults: z.number().positive().default(5),

  // Zoro knowledge builder
  zoroEnabled: optionalBoolean.default(true),
  zoroIndexIntervalMs: z.number().positive().default(30_000),
  zoroKnowledgeDir: z.string().default('./knowledge'),

  // Health monitoring (Tony)
  tonyCheckIntervalMs: z.number().positive().default(5000),
  tonyStuckThresholdMs: z.number().positive().default(60000),

  // Task management
  taskMaxConcurrent: z.number().positive().default(10),
  taskQueueSize: z.number().positive().default(1000),
  taskPersistenceEnabled: optionalBoolean.default(true),

  // Persistence
  persistenceType: z.enum(['memory', 'file']).default('file'),
  dbPath: z.string().default('./data/store.json'),

  // Admin
  adminUserIds: z
    .string()
    .default('')
    .transform(s =>
      s
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
        .map(x => parseInt(x, 10))
        .filter(Number.isFinite)
    ),

  // Features
  useMockAgents: optionalBoolean.default(false),
  useMockTelegram: optionalBoolean.default(false),
  enableAuditLogs: optionalBoolean.default(true),
  enableTaskInspection: optionalBoolean.default(true),
});

type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const env = process.env;

  const rawConfig = {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    llmProvider: env.LLM_PROVIDER as 'groq' | 'anthropic' | 'mock' | undefined,
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
    agentTimeoutMs: env.AGENT_TIMEOUT_MS ? parseInt(env.AGENT_TIMEOUT_MS) : undefined,
    agentMaxRetries: env.AGENT_MAX_RETRIES ? parseInt(env.AGENT_MAX_RETRIES) : undefined,
    agentRetryDelayMs: env.AGENT_RETRY_DELAY_MS ? parseInt(env.AGENT_RETRY_DELAY_MS) : undefined,
    contextRootDir: env.CONTEXT_ROOT_DIR,
    contextSearchDepth: env.CONTEXT_SEARCH_DEPTH ? parseInt(env.CONTEXT_SEARCH_DEPTH) : undefined,
    githubToken: env.GITHUB_TOKEN,
    githubUsername: env.GITHUB_USERNAME,
    githubMaxResults: env.GITHUB_MAX_RESULTS ? parseInt(env.GITHUB_MAX_RESULTS) : undefined,
    zoroEnabled: env.ZORO_ENABLED,
    zoroIndexIntervalMs: env.ZORO_INDEX_INTERVAL_MS ? parseInt(env.ZORO_INDEX_INTERVAL_MS) : undefined,
    zoroKnowledgeDir: env.ZORO_KNOWLEDGE_DIR,
    contextMaxResults: env.CONTEXT_MAX_RESULTS ? parseInt(env.CONTEXT_MAX_RESULTS) : undefined,
    tonyCheckIntervalMs: env.TONY_CHECK_INTERVAL_MS ? parseInt(env.TONY_CHECK_INTERVAL_MS) : undefined,
    tonyStuckThresholdMs: env.TONY_STUCK_THRESHOLD_MS ? parseInt(env.TONY_STUCK_THRESHOLD_MS) : undefined,
    taskMaxConcurrent: env.TASK_MAX_CONCURRENT ? parseInt(env.TASK_MAX_CONCURRENT) : undefined,
    taskQueueSize: env.TASK_QUEUE_SIZE ? parseInt(env.TASK_QUEUE_SIZE) : undefined,
    taskPersistenceEnabled: env.TASK_PERSISTENCE_ENABLED,
    persistenceType: env.PERSISTENCE_TYPE as 'memory' | 'file' | undefined,
    dbPath: env.DB_PATH,
    adminUserIds: env.ADMIN_USER_IDS,
    useMockAgents: env.USE_MOCK_AGENTS,
    useMockTelegram: env.USE_MOCK_TELEGRAM,
    enableAuditLogs: env.ENABLE_AUDIT_LOGS,
    enableTaskInspection: env.ENABLE_TASK_INSPECTION,
  };

  return configSchema.parse(rawConfig);
}

export type { Config };
