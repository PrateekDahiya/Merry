import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/config/validate.js';
import type { Config } from '../../src/config/config.js';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    telegramBotToken: '7830437060:AAHxyz12345678901234567890123456789',
    telegramWebhookSecret: 'secret',
    llmProvider: 'groq',
    groqApiKey: 'gsk_test',
    groqModel: 'llama-3.3-70b-versatile',
    anthropicApiKey: undefined,
    anthropicModel: 'claude-sonnet-4-6',
    ollamaBaseUrl: undefined,
    ollamaModel: 'llama3.2',
    zoroLlmProvider: undefined,
    zoroOllamaBaseUrl: undefined,
    zoroOllamaModel: undefined,
    logLevel: 'info',
    nodeEnv: 'test',
    agentTimeoutMs: 30000,
    contextRootDir: './knowledge',
    contextSearchDepth: 3,
    contextMaxResults: 10,
    githubToken: 'ghp_test',
    githubUsername: 'testuser',
    githubMaxResults: 5,
    zoroEnabled: true,
    zoroWebSearchEnabled: true,
    zoroWorkers: 3,
    zoroWorkerIdleMs: 5000,
    zoroDiscoveryIntervalMs: 300000,
    zoroRateLimitSleepMs: 60000,
    zoroKnowledgeDir: './knowledge',
    tonyCheckIntervalMs: 5000,
    tonyStuckThresholdMs: 60000,
    tonyReportIntervalMs: 1800000,
    crewChatEnabled: true,
    crewChatIntervalMs: 1200000,
    crewChatMinDelayMs: 600000,
    crewChatInactiveThresholdMs: 172800000,
    userLatitude: undefined,
    userLongitude: undefined,
    userCity: undefined,
    brookEnabled: true,
    brookOnepieceIntervalMs: 14400000,
    brookAnimeIntervalMs: 14400000,
    brookMusicIntervalMs: 21600000,
    brookNewsIntervalMs: 7200000,
    brookSingIntervalMs: 5400000,
    brookMinDelayMs: 900000,
    frankyChatEnabled: true,
    frankyChatIntervalMs: 2700000,
    frankyChatMinDelayMs: 1800000,
    luffyEnabled: true,
    luffyCheckIntervalMs: 300000,
    luffyReportToChat: true,
    chatHistoryTurns: 5,
    adminUserIds: [],
    adminChatIds: ['7830437060'],
    enableAuditLogs: true,
    useMockAgents: false,
    useMockTelegram: false,
    persistenceType: 'file',
    dbPath: './data/store.json',
    userProfileEnabled: true,
    ...overrides,
  } as Config;
}

describe('validateConfig', () => {
  it('passes valid configuration', () => {
    const result = validateConfig(makeConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails on malformed bot token', () => {
    const result = validateConfig(makeConfig({ telegramBotToken: 'bad-token' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('TELEGRAM_BOT_TOKEN');
  });

  it('fails when no LLM is configured and not mock mode', () => {
    const result = validateConfig(makeConfig({
      groqApiKey: undefined,
      anthropicApiKey: undefined,
      ollamaBaseUrl: undefined,
      useMockAgents: false,
    }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('No LLM configured');
  });

  it('passes when mock mode and no LLM', () => {
    const result = validateConfig(makeConfig({
      groqApiKey: undefined,
      anthropicApiKey: undefined,
      ollamaBaseUrl: undefined,
      useMockAgents: true,
    }));
    expect(result.valid).toBe(true);
  });

  it('warns when ADMIN_CHAT_IDS is empty in live mode', () => {
    const result = validateConfig(makeConfig({ adminChatIds: [], useMockTelegram: false }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('ADMIN_CHAT_IDS'))).toBe(true);
  });

  it('no warning for empty ADMIN_CHAT_IDS in mock telegram mode', () => {
    const result = validateConfig(makeConfig({ adminChatIds: [], useMockTelegram: true }));
    expect(result.warnings.some(w => w.includes('ADMIN_CHAT_IDS'))).toBe(false);
  });

  it('warns when Zoro enabled but no GitHub token', () => {
    const result = validateConfig(makeConfig({ zoroEnabled: true, githubToken: undefined }));
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('GITHUB_TOKEN'))).toBe(true);
  });
});
