import { ChatMetadataStore } from '../persistence/store.js';
import { notifier } from '../telegram/notifier.js';
import { WeatherService } from '../services/weather.js';
import { getClockContext } from '../services/clock.js';
import { selectScript, generateLlmConversation, ConversationContext } from './conversations.js';
import { LlmClient } from '../llm/client.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'crew-scheduler' });

export interface CrewSchedulerOptions {
  store: ChatMetadataStore;
  weather: WeatherService;
  llm?: LlmClient;
  intervalMs?: number;
  minDelayMs?: number;
  inactiveThresholdMs?: number;
  llmConversationChance?: number;
}

/**
 * CrewScheduler — sends proactive crew conversations to active Telegram chats.
 *
 * Fires every intervalMs (± 25% jitter so timing feels organic). For each
 * eligible chat it sends a scripted or LLM-generated multi-agent conversation
 * with realistic delays between messages.
 *
 * Anti-spam: a chat must have been active within inactiveThresholdMs AND must
 * not have received a crew message within minDelayMs.
 */
export class CrewScheduler {
  private readonly intervalMs: number;
  private readonly minDelayMs: number;
  private readonly inactiveThresholdMs: number;
  private readonly llmConversationChance: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(private readonly options: CrewSchedulerOptions) {
    this.intervalMs = options.intervalMs ?? 1_200_000;         // 20 min default
    this.minDelayMs = options.minDelayMs ?? 600_000;           // 10 min anti-spam
    this.inactiveThresholdMs = options.inactiveThresholdMs ?? 172_800_000; // 48 h
    this.llmConversationChance = options.llmConversationChance ?? 0.3;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.scheduleNext();
    logger.info(
      { intervalMs: this.intervalMs, minDelayMs: this.minDelayMs },
      'CrewScheduler started — the crew will chat spontaneously'
    );
  }

  stop(): void {
    this.active = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    logger.info('CrewScheduler stopped');
  }

  /** Run one cycle immediately (useful for testing). */
  async runNow(): Promise<void> {
    await this.run();
  }

  private scheduleNext(): void {
    if (!this.active) return;
    // ± 25% jitter around base interval — feels less mechanical
    const jitter = (Math.random() - 0.5) * 0.5 * this.intervalMs;
    const next = Math.max(30_000, this.intervalMs + jitter);
    this.timer = setTimeout(() => {
      void this.run().finally(() => this.scheduleNext());
    }, next);
  }

  private async run(): Promise<void> {
    if (!this.active) return;

    const chatIds = await this.options.store.listAllChatIds();
    if (chatIds.length === 0) return;

    const clock = getClockContext();
    const weather = await this.options.weather.getCurrentWeather();

    const ctx: ConversationContext = {
      timeOfDay: clock.timeOfDay,
      dayPeriod: clock.dayPeriod,
      dayName: clock.dayName,
      temperatureCelsius: weather?.temperatureCelsius,
      condition: weather?.condition,
    };

    const now = Date.now();
    const eligible: string[] = [];

    for (const chatId of chatIds) {
      const meta = await this.options.store.getChatMetadata(chatId);
      if (!meta) continue;

      const lastSeen = meta['lastSeenAt'] ? new Date(meta['lastSeenAt'] as string).getTime() : 0;
      const lastCrew = meta['lastCrewMessageAt'] ? new Date(meta['lastCrewMessageAt'] as string).getTime() : 0;

      if (now - lastSeen > this.inactiveThresholdMs) continue;   // chat gone cold
      if (now - lastCrew < this.minDelayMs) continue;            // too soon
      eligible.push(chatId);
    }

    if (eligible.length === 0) {
      logger.debug('CrewScheduler: no eligible chats this cycle');
      return;
    }

    const script = await this.buildConversation(ctx);

    for (const chatId of eligible) {
      try {
        await notifier.sendSequence(Number(chatId), script);
        const meta = (await this.options.store.getChatMetadata(chatId)) ?? {};
        await this.options.store.saveChatMetadata(chatId, {
          ...meta,
          lastCrewMessageAt: new Date().toISOString(),
        });
        logger.info({ chatId, steps: script.length, timeOfDay: ctx.timeOfDay }, 'CrewScheduler: sent proactive conversation');
      } catch (err) {
        logger.warn({ chatId, err: String(err) }, 'CrewScheduler: failed to send');
      }
    }
  }

  private async buildConversation(ctx: ConversationContext) {
    if (this.options.llm && Math.random() < this.llmConversationChance) {
      const generated = await generateLlmConversation(this.options.llm, ctx);
      if (generated) return generated;
    }
    return selectScript(ctx);
  }
}
