import dotenv from 'dotenv';

dotenv.config();

import { loadConfig } from './config/config.js';
import { initializeLogger, getLogger } from './logging/logger.js';
import { createStore } from './persistence/factory.js';
import { TomAgent } from './agents/tom.js';
import { AceAgent } from './agents/ace.js';
import { TonyAgent } from './agents/tony.js';
import { NamiAgent } from './agents/nami.js';
import { TonyMonitor } from './monitoring/monitor.js';
import { Phase2AceDispatcher } from './orchestrator/phase2-dispatcher.js';
import { TelegrafTelegramClient } from './telegram/telegraf-client.js';
import { createLlmClient } from './llm/client.js';

const logger = getLogger();

async function main() {
  try {
    logger.info('Telegram Agent Orchestrator starting...');

    const config = loadConfig();
    initializeLogger(config);
    logger.info({ env: config.nodeEnv, logLevel: config.logLevel }, 'Configuration loaded');

    const store = createStore(config.persistenceType, config.dbPath);
    logger.info({ persistenceType: config.persistenceType }, 'Persistence store initialized');

    const llm = createLlmClient({
      mock: config.useMockAgents,
      provider: config.llmProvider,
      groqApiKey: config.groqApiKey,
      groqModel: config.groqModel,
      anthropicApiKey: config.anthropicApiKey,
      anthropicModel: config.anthropicModel,
    });
    const activeProvider = config.useMockAgents ? 'mock'
      : (config.llmProvider ?? (config.groqApiKey ? 'groq' : config.anthropicApiKey ? 'anthropic' : 'mock'));
    logger.info({ provider: activeProvider }, 'LLM client initialized');

    const tonyMonitor = new TonyMonitor(store, {
      checkIntervalMs: config.tonyCheckIntervalMs,
      stuckThresholdMs: config.tonyStuckThresholdMs,
    });

    const ace = new AceAgent({
      store,
      llm,
      monitor: tonyMonitor,
      contextAgentFactory: () =>
        new NamiAgent({
          maxDepth: config.contextSearchDepth,
          maxResults: config.contextMaxResults,
        }),
    });

    const tony = new TonyAgent({ store, monitor: tonyMonitor });
    await tony.onStart();
    logger.info('Tony watchdog started');

    let tom: TomAgent | null = null;

    if (config.useMockTelegram) {
      logger.info('Mock Telegram mode enabled; live Telegram listener not started');
    } else {
      tom = new TomAgent({
        client: new TelegrafTelegramClient(config.telegramBotToken),
        dispatcher: new Phase2AceDispatcher(store, ace),
      });
      await tom.start();
    }

    logger.info(
      {
        version: '0.2.0',
        phase: '9 - Production Ready',
        components: [
          'config',
          'logging',
          'persistence',
          'llm-client',
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
          'tony-agent',
          'tony-monitor',
          'file-store',
        ],
      },
      'All components initialized. System ready.'
    );

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully...');
      await tony.onStop();
      await tom?.stop(signal);
      const fileStore = store as { flush?: () => void };
      if (typeof fileStore.flush === 'function') fileStore.flush();
      process.exit(0);
    };

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    logger.error(error, 'Fatal error during startup');
    process.exit(1);
  }
}

main();
