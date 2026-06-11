import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { loadConfig } from './config/config.js';
import { initializeLogger, getLogger } from './logging/logger.js';
import { initializeStore } from './persistence/store.js';
import { TomAgent } from './agents/tom.js';
import { Phase2AceDispatcher } from './orchestrator/phase2-dispatcher.js';
import { TelegrafTelegramClient } from './telegram/telegraf-client.js';

const logger = getLogger();

/**
 * Main entry point for the Telegram Agent Orchestrator system.
 * Phase 1: Foundation setup and health check.
 */
async function main() {
  try {
    logger.info('Telegram Agent Orchestrator starting...');

    // Load configuration
    const config = loadConfig();
    logger.info({ env: config.nodeEnv, logLevel: config.logLevel }, 'Configuration loaded');

    // Initialize logger with config
    initializeLogger(config);

    // Initialize persistence store
    const store = initializeStore();
    logger.info('Persistence store initialized');

    let tom: TomAgent | null = null;

    if (config.useMockTelegram) {
      logger.info('Mock Telegram mode enabled; live Telegram listener not started');
    } else {
      tom = new TomAgent({
        client: new TelegrafTelegramClient(config.telegramBotToken),
        dispatcher: new Phase2AceDispatcher(store),
      });

      await tom.start();
    }

    // Log all components are ready
    logger.info(
      {
        version: '0.1.0',
        phase: '2 - Telegram Entrypoint',
        components: [
          'config',
          'logging',
          'persistence',
          'agent-base',
          'message-types',
          'error-types',
          'telegram-client',
          'tom-agent',
          'phase2-ace-dispatcher',
        ],
      },
      'All Phase 1 and Phase 2 components initialized'
    );

    logger.info('System ready. Phases 3-9 pending implementation.');

    // Graceful shutdown handler
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      await tom?.stop('SIGINT');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down gracefully...');
      await tom?.stop('SIGTERM');
      process.exit(0);
    });
  } catch (error) {
    logger.error(error, 'Fatal error during startup');
    process.exit(1);
  }
}

main();
