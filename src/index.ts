import dotenv from 'dotenv';

dotenv.config();

import { loadConfig } from './config/config.js';
import { assertValidConfig } from './config/validate.js';
import { initializeLogger, getLogger } from './logging/logger.js';
import { createStore } from './persistence/factory.js';
import { JinbeAgent } from './agents/jinbe.js';
import { AceAgent } from './agents/ace.js';
import { TonyAgent } from './agents/tony.js';
import { ZoroAgent } from './agents/zoro.js';
import { NamiAgent } from './agents/nami.js';
import { TonyMonitor } from './monitoring/monitor.js';
import { Phase2AceDispatcher } from './orchestrator/phase2-dispatcher.js';
import { TelegrafTelegramClient } from './telegram/telegraf-client.js';
import { createLlmClient } from './llm/client.js';
import { notifier } from './telegram/notifier.js';
import { WeatherService } from './services/weather.js';
import { CrewScheduler } from './crew/scheduler.js';
import { startMetricsServer, stopMetricsServer } from './monitoring/metrics.js';
import { BrookAgent } from './agents/brook.js';
import { FrankyAgent } from './agents/franky.js';
import { LuffyAgent } from './agents/luffy.js';

const logger = getLogger();

async function main() {
  try {
    logger.info('Telegram Agent Orchestrator starting...');

    const config = loadConfig();
    assertValidConfig(config);           // fail fast on bad config
    initializeLogger(config);
    logger.info({ env: config.nodeEnv, logLevel: config.logLevel }, 'Configuration loaded');

    const store = createStore(config.persistenceType, config.dbPath);
    logger.info({ persistenceType: config.persistenceType }, 'Persistence store initialized');

    // Main LLM — used by Robin and Sanji for user-facing responses
    const llm = createLlmClient({
      mock: config.useMockAgents,
      provider: config.llmProvider,
      groqApiKey: config.groqApiKey,
      groqModel: config.groqModel,
      anthropicApiKey: config.anthropicApiKey,
      anthropicModel: config.anthropicModel,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaModel: config.ollamaModel,
    });
    const activeProvider = config.useMockAgents ? 'mock'
      : (config.llmProvider ?? (config.ollamaBaseUrl ? 'ollama' : config.groqApiKey ? 'groq' : config.anthropicApiKey ? 'anthropic' : 'mock'));
    logger.info({ provider: activeProvider }, 'LLM client initialized');

    // Zoro LLM — separate client for background knowledge indexing.
    // Defaults to main LLM if ZORO_LLM_PROVIDER is not set.
    // Typical setup: ZORO_LLM_PROVIDER=ollama (local, free, no rate limits)
    //                LLM_PROVIDER=groq (fast, for user responses)
    const zoroLlm = config.zoroLlmProvider
      ? createLlmClient({
          mock: config.useMockAgents,
          provider: config.zoroLlmProvider,
          groqApiKey: config.groqApiKey,
          groqModel: config.groqModel,
          anthropicApiKey: config.anthropicApiKey,
          anthropicModel: config.anthropicModel,
          ollamaBaseUrl: config.zoroOllamaBaseUrl ?? config.ollamaBaseUrl,
          ollamaModel: config.zoroOllamaModel ?? config.ollamaModel,
        })
      : llm;

    if (config.zoroLlmProvider) {
      logger.info({ provider: config.zoroLlmProvider }, 'Zoro using separate LLM');
    }

    // Create WeatherService once — shared by Nami (for user queries) and CrewScheduler (for proactive chat)
    const weatherService = new WeatherService({
      latitude: config.userLatitude,
      longitude: config.userLongitude,
      city: config.userCity,
    });

    const namiFactory = () => new NamiAgent({
      rootDir: config.contextRootDir,
      maxDepth: config.contextSearchDepth,
      maxResults: config.contextMaxResults,
      github: config.githubToken && config.githubUsername
        ? { token: config.githubToken, username: config.githubUsername, maxResults: config.githubMaxResults }
        : undefined,
      weather: weatherService,
    });

    const tonyMonitor = new TonyMonitor(store, {
      checkIntervalMs: config.tonyCheckIntervalMs,
      stuckThresholdMs: config.tonyStuckThresholdMs,
      reportIntervalMs: config.tonyReportIntervalMs,
    });
    tonyMonitor.setChatStore(store);  // so Tony can find chat IDs for health reports

    // Zoro — knowledge builder (needs GitHub creds)
    let zoro: ZoroAgent | undefined;
    if (config.zoroEnabled && config.githubToken && config.githubUsername) {
      zoro = new ZoroAgent({
        knowledgeDir: config.zoroKnowledgeDir,
        githubToken: config.githubToken,
        githubUsername: config.githubUsername,
        llm: zoroLlm,
        monitor: tonyMonitor,
        webSearchEnabled: config.zoroWebSearchEnabled,
        workers: config.zoroWorkers,
        workerIdleMs: config.zoroWorkerIdleMs,
        discoveryIntervalMs: config.zoroDiscoveryIntervalMs,
        rateLimitSleepMs: config.zoroRateLimitSleepMs,
      });
      tonyMonitor.setZoroSource(zoro);
      zoro.startIndexing();
      logger.info(
        { workers: config.zoroWorkers, knowledgeDir: config.zoroKnowledgeDir },
        'Zoro knowledge builder started'
      );
    } else {
      logger.info('Zoro disabled (needs GITHUB_TOKEN + GITHUB_USERNAME + ZORO_ENABLED=true)');
    }

    const ace = new AceAgent({
      store, llm, monitor: tonyMonitor, zoro, contextAgentFactory: namiFactory,
      chatHistoryTurns: config.chatHistoryTurns,
      knowledgeDir: config.userProfileEnabled ? config.zoroKnowledgeDir : undefined,
    });

    let jinbe: JinbeAgent | null = null;

    if (config.useMockTelegram) {
      logger.info('Mock Telegram mode enabled; live Telegram listener not started');
      // Start Tony even in mock mode (just no Telegram sends)
      const tony = new TonyAgent({ store, monitor: tonyMonitor });
      await tony.onStart();
      logger.info('Tony watchdog started');
    } else {
      const telegramClient = new TelegrafTelegramClient(config.telegramBotToken, {
        store,
        monitor: tonyMonitor,
        zoro,
        adminUserIds: config.adminUserIds,
      });
      notifier.setClient(telegramClient);
      // Tony starts AFTER notifier has a client so its health reports reach Telegram
      const tony = new TonyAgent({ store, monitor: tonyMonitor });
      await tony.onStart();
      logger.info('Tony watchdog started');

      // Warn if no admin chat IDs — proactive messages won't fire until user messages first
      if (config.adminChatIds.length === 0) {
        logger.warn('ADMIN_CHAT_IDS is not set. Proactive messages (Brook, Franky, CrewScheduler) will only reach chats that have messaged the bot first. Set ADMIN_CHAT_IDS=<your_telegram_chat_id> to receive messages immediately on startup.');
      }

      // Register admin chat IDs — always refresh lastSeenAt so 48h inactivity
      // checks never block proactive messages to admin chats
      if (config.adminChatIds.length > 0) {
        for (const chatId of config.adminChatIds) {
          const existing = (await store.getChatMetadata(chatId)) ?? {};
          await store.saveChatMetadata(chatId, {
            ...existing,
            chatId,
            lastSeenAt: new Date().toISOString(),  // always refresh, not just on first register
          });
        }
        logger.info({ chatIds: config.adminChatIds }, 'Admin chat IDs refreshed — proactive messages enabled');
      }
      jinbe = new JinbeAgent({
        client: telegramClient,
        dispatcher: new Phase2AceDispatcher(store, ace),
        store,
        knowledgeDir: config.userProfileEnabled ? config.zoroKnowledgeDir : undefined,
      });
      await jinbe.start();

      if (config.crewChatEnabled) {
        const crewScheduler = new CrewScheduler({
          store,
          weather: weatherService,
          llm,
          intervalMs: config.crewChatIntervalMs,
          minDelayMs: config.crewChatMinDelayMs,
          inactiveThresholdMs: config.crewChatInactiveThresholdMs,
        });
        crewScheduler.start();
        process.on('SIGINT', () => crewScheduler.stop());
        process.on('SIGTERM', () => crewScheduler.stop());
        logger.info({ intervalMs: config.crewChatIntervalMs }, 'CrewScheduler started');
      }

      if (config.brookEnabled) {
        const brook = new BrookAgent({
          store,
          llm,
          knowledgeDir: config.zoroKnowledgeDir,
          onepieceIntervalMs: config.brookOnepieceIntervalMs,
          animeIntervalMs:    config.brookAnimeIntervalMs,
          musicIntervalMs:    config.brookMusicIntervalMs,
          newsIntervalMs:     config.brookNewsIntervalMs,
          singIntervalMs:     config.brookSingIntervalMs,
          minDelayMs:         config.brookMinDelayMs,
          monitor:            tonyMonitor,
        });
        brook.start();
        process.on('SIGINT', () => brook.stop());
        process.on('SIGTERM', () => brook.stop());
        logger.info('Brook started — Yohoho! 💀');
      }

      if (config.frankyChatEnabled) {
        const franky = new FrankyAgent({
          store,
          llm,
          weather: weatherService,
          knowledgeDir: config.userProfileEnabled ? config.zoroKnowledgeDir : undefined,
          intervalMs: config.frankyChatIntervalMs,
          minDelayMs: config.frankyChatMinDelayMs,
          monitor: tonyMonitor,
        });
        franky.start();
        process.on('SIGINT', () => franky.stop());
        process.on('SIGTERM', () => franky.stop());
        logger.info('Franky started — SUPER! 🔧');
      }

      if (config.luffyEnabled) {
        const luffy = new LuffyAgent({
          store,
          monitor: tonyMonitor,
          zoro,
          intervalMs: config.luffyCheckIntervalMs,
          reportToChat: config.luffyReportToChat,
          expectedIntervals: {
            brook: config.brookSingIntervalMs,
            franky: config.frankyChatIntervalMs,
            crew: config.crewChatIntervalMs,
          },
        });
        luffy.start();
        process.on('SIGINT', () => luffy.stop());
        process.on('SIGTERM', () => luffy.stop());
        logger.info('Luffy started — I\'m the captain! 🍖');
      }
    }

    // Start Prometheus metrics endpoint on port 9090
    startMetricsServer(9090);

    logger.info(
      { version: '0.8.0', components: ['ace', 'jinbe', 'robin', 'sanji', 'nami', 'tony', 'zoro', 'brook', 'franky', 'luffy'] },
      'All components initialized. System ready.'
    );

    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Shutting down gracefully...');
      zoro?.stopIndexing();
      tonyMonitor.stop();
      stopMetricsServer();
      await jinbe?.stop(signal);
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
