import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { loadConfig } from './config/config.js';
import { initializeLogger, getLogger } from './logging/logger.js';
import { initializeStore } from './persistence/store.js';
import { TomAgent } from './agents/tom.js';
import { AceAgent } from './agents/ace.js';
import { NamiAgent } from './agents/nami.js';
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
        dispatcher: new Phase2AceDispatcher(
          store,
          new AceAgent({
            store,
            contextAgentFactory: () =>
              new NamiAgent({
                maxDepth: config.contextSearchDepth,
                maxResults: config.contextMaxResults,
              }),
          })
        ),
      });

      await tom.start();
    }

    // Log all components are ready
    logger.info(
      {
        version: '0.1.0',
        phase: '5 - Specialist Agents',
        components: [
          'config',
          'logging',
          'persistence',
          'agent-base',
          'message-types',
          'error-types',
          'telegram-client',
          'tom-agent',
          'ace-agent',
          'routing',
          'telegram-ace-dispatcher',
          'context-search',
          'nami-agent',
          'specialist-contract',
          'robin-agent',
          'sanji-agent',
        ],
      },
      'All Phase 1, Phase 2, Phase 3, Phase 4, and Phase 5 components initialized'
    );

    logger.info('System ready. Phases 6-9 pending implementation.');

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
