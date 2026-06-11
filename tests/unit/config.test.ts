import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/config.js';

describe('Configuration', () => {
  it('should load configuration with defaults', () => {
    // Set minimal required env vars
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';

    const config = loadConfig();

    expect(config.telegramBotToken).toBe('test-token');
    expect(config.logLevel).toBe('info');
    expect(config.nodeEnv).toBe('development');
    expect(config.agentTimeoutMs).toBe(30000);
    expect(config.taskMaxConcurrent).toBe(10);
  });

  it('should parse integer values correctly', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.AGENT_TIMEOUT_MS = '60000';
    process.env.TASK_MAX_CONCURRENT = '20';

    const config = loadConfig();

    expect(config.agentTimeoutMs).toBe(60000);
    expect(config.taskMaxConcurrent).toBe(20);
  });

  it('should parse boolean values correctly', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.USE_MOCK_AGENTS = 'true';
    process.env.ENABLE_AUDIT_LOGS = 'false';

    const config = loadConfig();

    expect(config.useMockAgents).toBe(true);
    expect(config.enableAuditLogs).toBe(false);
  });
});
