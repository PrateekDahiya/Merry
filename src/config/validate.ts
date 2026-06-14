import type { Config } from './config.js';
import { getLogger } from '../logging/logger.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates critical configuration at startup. Throws on fatal errors,
 * logs warnings for non-fatal issues. Call before any agent starts.
 */
export function validateConfig(config: Config): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Telegram bot token format: {digits}:{35-char base64url}
  if (!config.telegramBotToken.match(/^\d+:[A-Za-z0-9_-]{35,}$/)) {
    errors.push(
      'TELEGRAM_BOT_TOKEN looks invalid. Expected format: {id}:{hash} (get one from @BotFather)'
    );
  }

  // At least one LLM must be configured when not in mock mode
  if (!config.useMockAgents) {
    const hasGroq = Boolean(config.groqApiKey);
    const hasAnthropic = Boolean(config.anthropicApiKey);
    const hasOllama = Boolean(config.ollamaBaseUrl);
    if (!hasGroq && !hasAnthropic && !hasOllama) {
      errors.push(
        'No LLM configured. Set at least one of: GROQ_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_BASE_URL'
      );
    }
  }

  // Admin chat IDs — warn but don't block
  if (config.adminChatIds.length === 0 && !config.useMockTelegram) {
    warnings.push(
      'ADMIN_CHAT_IDS is not set. Proactive messages (Brook, Franky, CrewScheduler) will only ' +
      'reach chats that have already messaged the bot. Set ADMIN_CHAT_IDS=<your_telegram_chat_id>'
    );
  }

  // GitHub token — warn if Zoro is enabled without it
  if (config.zoroEnabled && !config.githubToken) {
    warnings.push(
      'ZORO_ENABLED=true but GITHUB_TOKEN is not set. Zoro will not index any repos.'
    );
  }

  // Knowledge dir — warn if web search enabled but no knowledge dir
  if (config.zoroWebSearchEnabled && !config.contextRootDir) {
    warnings.push(
      'ZORO_WEB_SEARCH_ENABLED=true but CONTEXT_ROOT_DIR is not set. ' +
      'Web knowledge will still be written but Nami may not find it.'
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates config and throws if invalid. Logs warnings to console.
 * Use at the start of main() before any agent is created.
 */
export function assertValidConfig(config: Config): void {
  const result = validateConfig(config);

  const logger = getLogger();
  for (const warning of result.warnings) {
    logger.warn({ component: 'config' }, warning);
  }

  if (!result.valid) {
    const msg = [
      'Configuration errors found — cannot start:',
      ...result.errors.map(e => `  • ${e}`),
    ].join('\n');
    throw new Error(msg);
  }
}
