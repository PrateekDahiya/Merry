import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { loadConfig } from './config/config.js';
import { initializeLogger, getLogger } from './logging/logger.js';
import { initializeStore } from './persistence/store.js';

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
    initializeStore();
    logger.info('Persistence store initialized');

    // Log all components are ready
    logger.info(
      {
        version: '0.1.0',
        phase: '1 - Foundation',
        components: [
          'config',
          'logging',
          'persistence',
          'agent-base',
          'message-types',
          'error-types',
        ],
      },
      'All Phase 1 components initialized'
    );

    logger.info('System ready. Phases 2-9 pending implementation.');

    // Graceful shutdown handler
    process.on('SIGINT', async () => {
      logger.info('Shutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('Shutting down gracefully...');
      process.exit(0);
    });
  } catch (error) {
    logger.error(error, 'Fatal error during startup');
    process.exit(1);
  }
}

main();
