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

  // LLM provider for Robin/Sanji (user-facing responses)
  llmProvider: z.enum(['groq', 'anthropic', 'ollama', 'mock']).optional(),

  // Groq
  groqApiKey: z.string().optional(),
  groqModel: z.string().default('llama-3.3-70b-versatile'),

  // Anthropic Claude (alternative)
  anthropicApiKey: z.string().optional(),
  anthropicModel: z.string().default('claude-sonnet-4-6'),

  // Ollama (local — no API key, no rate limits)
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  ollamaModel: z.string().default('llama3.2'),

  // Zoro-specific LLM (defaults to main LLM_PROVIDER if not set)
  // Set ZORO_LLM_PROVIDER=ollama to use local Ollama just for indexing
  zoroLlmProvider: z.enum(['groq', 'anthropic', 'ollama', 'mock']).optional(),
  zoroOllamaBaseUrl: z.string().optional(),
  zoroOllamaModel: z.string().optional(),

  // Logging
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Agent behavior
  agentTimeoutMs: z.number().positive().default(30000),

  // Context service
  contextRootDir: z.string().optional(),
  contextSearchDepth: z.number().positive().default(3),
  contextMaxResults: z.number().positive().default(10),

  // GitHub context source
  githubToken: z.string().optional(),
  githubUsername: z.string().optional(),
  githubMaxResults: z.number().positive().default(5),

  // Luffy agent (captain — behavioral monitoring)
  luffyEnabled: optionalBoolean.default(true),
  luffyCheckIntervalMs: z.number().positive().default(300_000),   // 5 min
  luffyReportToChat: optionalBoolean.default(true),

  // Chat history memory
  chatHistoryTurns: z.number().min(0).max(20).default(5),

  // Franky agent (inter-agent conversation director)
  frankyChatEnabled: optionalBoolean.default(true),
  frankyChatIntervalMs: z.number().positive().default(2_700_000),   // 45 min
  frankyChatMinDelayMs: z.number().positive().default(1_800_000),   // 30 min

  // Brook agent (news herald + Soul King)
  brookEnabled: optionalBoolean.default(true),
  brookOnepieceIntervalMs: z.number().positive().default(14_400_000),
  brookAnimeIntervalMs:    z.number().positive().default(14_400_000),
  brookMusicIntervalMs:    z.number().positive().default(21_600_000),
  brookNewsIntervalMs:     z.number().positive().default(7_200_000),
  brookSingIntervalMs:     z.number().positive().default(5_400_000),
  brookMinDelayMs:         z.number().positive().default(900_000),    // 15 min

  // Proactive crew messaging
  crewChatEnabled: optionalBoolean.default(true),
  crewChatIntervalMs: z.number().positive().default(1_200_000),
  crewChatMinDelayMs: z.number().positive().default(600_000),
  crewChatInactiveThresholdMs: z.number().positive().default(172_800_000),

  // User location for weather context (optional)
  userLatitude: z.preprocess(v => v ? parseFloat(String(v)) : undefined, z.number().optional()),
  userLongitude: z.preprocess(v => v ? parseFloat(String(v)) : undefined, z.number().optional()),
  userCity: z.string().optional(),

  // Zoro knowledge builder
  zoroEnabled: optionalBoolean.default(true),
  zoroWorkers: z.number().min(1).max(10).default(3),
  zoroWorkerIdleMs: z.number().positive().default(5_000),
  zoroDiscoveryIntervalMs: z.number().positive().default(300_000),
  zoroRateLimitSleepMs: z.number().positive().default(60_000),
  zoroKnowledgeDir: z.string().default('./knowledge'),

  // Health monitoring (Tony)
  tonyCheckIntervalMs: z.number().positive().default(5000),
  tonyStuckThresholdMs: z.number().positive().default(60000),
  tonyReportIntervalMs: z.number().positive().default(1_800_000),  // 30 min health report

  // Persistence
  persistenceType: z.enum(['memory', 'file']).default('file'),
  dbPath: z.string().default('./data/store.json'),

  // Admin chat IDs — these chats receive proactive messages without needing to message first
  adminChatIds: z
    .string()
    .default('')
    .transform(s =>
      s.split(',').map(x => x.trim()).filter(Boolean)
    ),

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
    llmProvider: env.LLM_PROVIDER as 'groq' | 'anthropic' | 'ollama' | 'mock' | undefined,
    groqApiKey: env.GROQ_API_KEY,
    groqModel: env.GROQ_MODEL,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
    ollamaModel: env.OLLAMA_MODEL,
    zoroLlmProvider: env.ZORO_LLM_PROVIDER as 'groq' | 'anthropic' | 'ollama' | 'mock' | undefined,
    zoroOllamaBaseUrl: env.ZORO_OLLAMA_BASE_URL,
    zoroOllamaModel: env.ZORO_OLLAMA_MODEL,
    logLevel: env.LOG_LEVEL,
    nodeEnv: env.NODE_ENV,
    agentTimeoutMs: env.AGENT_TIMEOUT_MS ? parseInt(env.AGENT_TIMEOUT_MS) : undefined,
    contextRootDir: env.CONTEXT_ROOT_DIR,
    contextSearchDepth: env.CONTEXT_SEARCH_DEPTH ? parseInt(env.CONTEXT_SEARCH_DEPTH) : undefined,
    githubToken: env.GITHUB_TOKEN,
    githubUsername: env.GITHUB_USERNAME,
    githubMaxResults: env.GITHUB_MAX_RESULTS ? parseInt(env.GITHUB_MAX_RESULTS) : undefined,
    luffyEnabled:         env.LUFFY_ENABLED,
    luffyCheckIntervalMs: env.LUFFY_CHECK_INTERVAL_MS ? parseInt(env.LUFFY_CHECK_INTERVAL_MS) : undefined,
    luffyReportToChat:    env.LUFFY_REPORT_TO_CHAT,
    chatHistoryTurns:     env.CHAT_HISTORY_TURNS ? parseInt(env.CHAT_HISTORY_TURNS) : undefined,
    frankyChatEnabled:    env.FRANKY_CHAT_ENABLED,
    frankyChatIntervalMs: env.FRANKY_CHAT_INTERVAL_MS ? parseInt(env.FRANKY_CHAT_INTERVAL_MS) : undefined,
    frankyChatMinDelayMs: env.FRANKY_CHAT_MIN_DELAY_MS ? parseInt(env.FRANKY_CHAT_MIN_DELAY_MS) : undefined,
    brookEnabled:            env.BROOK_ENABLED,
    brookOnepieceIntervalMs: env.BROOK_ONEPIECE_INTERVAL_MS ? parseInt(env.BROOK_ONEPIECE_INTERVAL_MS) : undefined,
    brookAnimeIntervalMs:    env.BROOK_ANIME_INTERVAL_MS    ? parseInt(env.BROOK_ANIME_INTERVAL_MS)    : undefined,
    brookMusicIntervalMs:    env.BROOK_MUSIC_INTERVAL_MS    ? parseInt(env.BROOK_MUSIC_INTERVAL_MS)    : undefined,
    brookNewsIntervalMs:     env.BROOK_NEWS_INTERVAL_MS     ? parseInt(env.BROOK_NEWS_INTERVAL_MS)     : undefined,
    brookSingIntervalMs:     env.BROOK_SING_INTERVAL_MS     ? parseInt(env.BROOK_SING_INTERVAL_MS)     : undefined,
    brookMinDelayMs:         env.BROOK_MIN_DELAY_MS         ? parseInt(env.BROOK_MIN_DELAY_MS)         : undefined,
    crewChatEnabled: env.CREW_CHAT_ENABLED,
    crewChatIntervalMs: env.CREW_CHAT_INTERVAL_MS ? parseInt(env.CREW_CHAT_INTERVAL_MS) : undefined,
    crewChatMinDelayMs: env.CREW_CHAT_MIN_DELAY_MS ? parseInt(env.CREW_CHAT_MIN_DELAY_MS) : undefined,
    crewChatInactiveThresholdMs: env.CREW_CHAT_INACTIVE_THRESHOLD_MS ? parseInt(env.CREW_CHAT_INACTIVE_THRESHOLD_MS) : undefined,
    userLatitude: env.USER_LATITUDE,
    userLongitude: env.USER_LONGITUDE,
    userCity: env.USER_CITY,
    zoroEnabled: env.ZORO_ENABLED,
    zoroWorkers: env.ZORO_WORKERS ? parseInt(env.ZORO_WORKERS) : undefined,
    zoroWorkerIdleMs: env.ZORO_WORKER_IDLE_MS ? parseInt(env.ZORO_WORKER_IDLE_MS) : undefined,
    zoroDiscoveryIntervalMs: env.ZORO_DISCOVERY_INTERVAL_MS ? parseInt(env.ZORO_DISCOVERY_INTERVAL_MS) : undefined,
    zoroRateLimitSleepMs: env.ZORO_RATE_LIMIT_SLEEP_MS ? parseInt(env.ZORO_RATE_LIMIT_SLEEP_MS) : undefined,
    zoroKnowledgeDir: env.ZORO_KNOWLEDGE_DIR,
    contextMaxResults: env.CONTEXT_MAX_RESULTS ? parseInt(env.CONTEXT_MAX_RESULTS) : undefined,
    tonyCheckIntervalMs: env.TONY_CHECK_INTERVAL_MS ? parseInt(env.TONY_CHECK_INTERVAL_MS) : undefined,
    tonyStuckThresholdMs: env.TONY_STUCK_THRESHOLD_MS ? parseInt(env.TONY_STUCK_THRESHOLD_MS) : undefined,
    tonyReportIntervalMs: env.TONY_REPORT_INTERVAL_MS ? parseInt(env.TONY_REPORT_INTERVAL_MS) : undefined,
    persistenceType: env.PERSISTENCE_TYPE as 'memory' | 'file' | undefined,
    dbPath: env.DB_PATH,
    adminChatIds: env.ADMIN_CHAT_IDS,
    adminUserIds: env.ADMIN_USER_IDS,
    useMockAgents: env.USE_MOCK_AGENTS,
    useMockTelegram: env.USE_MOCK_TELEGRAM,
    enableAuditLogs: env.ENABLE_AUDIT_LOGS,
    enableTaskInspection: env.ENABLE_TASK_INSPECTION,
  };

  return configSchema.parse(rawConfig);
}

export type { Config };
