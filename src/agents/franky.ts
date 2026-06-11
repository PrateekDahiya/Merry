import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { LlmClient } from '../llm/client.js';
import { ChatMetadataStore } from '../persistence/store.js';
import { notifier, ConversationStep, AgentVoice } from '../telegram/notifier.js';
import { WeatherService } from '../services/weather.js';
import { getClockContext } from '../services/clock.js';
import { selectScript } from '../crew/conversations.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'franky' });

export interface FrankyOptions {
  store: ChatMetadataStore;
  llm: LlmClient;
  weather?: WeatherService;
  intervalMs?: number;
  minDelayMs?: number;
  firstFireDelayMs?: number;
}

const PARTICIPANTS: AgentVoice[] = ['ace', 'nami', 'robin', 'sanji', 'zoro', 'tony', 'brook', 'jinbe'];

const TOPICS = [
  "Zoro getting lost on the ship again",
  "Sanji's latest experimental dish that nobody can identify",
  "Robin found an ancient text with a dark warning",
  "Tony insisting the whole crew get medical checkups",
  "Brook wants someone to listen to his new song",
  "Nami discovered Zoro touched her navigation charts",
  "Jinbe spotted unusual weather patterns on the horizon",
  "Someone ate Ace's leftovers and won't admit it",
  "The ship needs maintenance — who broke what?",
  "Planning something fun for a free afternoon",
  "Debating who is the most useful crew member",
  "A mysterious treasure map Nami found in the last port",
  "Tony's new invention went slightly wrong",
  "Brook's Afro got tangled in the rigging again",
  "Sanji and Zoro arguing about who works harder",
];

const FRANKY_SYSTEM = `You are Franky, the Thousand Sunny's shipwright and crew conversation director for the Straw Hat Pirates. SUPER!

Generate a short, casual group-chat conversation between specific crew members about a given topic.

Rules (STRICT):
1. Return ONLY a raw JSON array — no markdown, no code fences, no explanation.
2. 3 to 5 message objects.
3. Each: { "agent": "<name>", "text": "<message>", "delayMs": <number> }
4. First message: delayMs = 0. Others: 2500 to 5000.
5. Each message: 1-2 short sentences. Starts with the character's emoji. In their distinct voice.
6. Character emojis and voices:
   ace(🔥) calm+confident, nami(🗺️) sharp+practical, robin(📖) calm+dry wit,
   sanji(🍳) passionate+perfectionist, zoro(⚔️) terse+training-obsessed,
   tony(🦌) enthusiastic doctor, brook(🎵💀) yohoho+skull puns, jinbe(🌊) honourable+calm
7. Franky himself may appear: { "agent": "franky", "text": "🔧 SUPER! ...", "delayMs": ... }
8. Valid agent names (lowercase): ace, nami, robin, sanji, zoro, tony, brook, jinbe, franky`;

/**
 * Franky — Inter-agent Conversation Director.
 *
 * While CrewScheduler sends fixed scripted conversations, Franky generates
 * DYNAMIC, LLM-powered exchanges between randomly-selected crew members on
 * a random topic. The result is spontaneous-feeling banter that changes every time.
 *
 * SUPER! 🔧
 */
export class FrankyAgent extends BaseAgent {
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly store: ChatMetadataStore;
  private readonly llm: LlmClient;
  private readonly weather?: WeatherService;
  private readonly intervalMs: number;
  private readonly minDelayMs: number;
  private readonly firstFireDelayMs: number;

  constructor(options: FrankyOptions) {
    super('franky-primary', 'franky');
    this.store = options.store;
    this.llm = options.llm;
    this.weather = options.weather;
    this.intervalMs = options.intervalMs ?? 2_700_000;      // 45 min
    this.minDelayMs = options.minDelayMs ?? 1_800_000;      // 30 min
    this.firstFireDelayMs = options.firstFireDelayMs ?? 20_000; // 20s
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.scheduleNext(this.firstFireDelayMs);
    logger.info({ intervalMs: this.intervalMs, firstFireMs: this.firstFireDelayMs }, 'Franky started — SUPER! 🔧');
  }

  stop(): void {
    this.active = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    logger.info('Franky stopped — that\'s not SUPER! 🔧');
  }

  protected async doWork(_task: TaskEnvelope): Promise<unknown> {
    return { status: 'ok', active: this.active };
  }

  private scheduleNext(delayMs = this.intervalMs): void {
    if (!this.active) return;
    const jitter = (Math.random() - 0.5) * 0.5 * this.intervalMs;
    const next = Math.max(60_000, delayMs + jitter);
    this.timer = setTimeout(() => {
      void this.run().finally(() => this.scheduleNext());
    }, next);
  }

  private async run(): Promise<void> {
    if (!this.active) return;

    const chatIds = await this.store.listAllChatIds();
    if (chatIds.length === 0) return;

    const now = Date.now();
    const eligible: string[] = [];

    for (const chatId of chatIds) {
      const meta = await this.store.getChatMetadata(chatId);
      if (!meta) continue;
      const lastSeen  = meta['lastSeenAt']        ? new Date(meta['lastSeenAt'] as string).getTime()        : 0;
      const lastFranky = meta['lastFrankyMessageAt'] ? new Date(meta['lastFrankyMessageAt'] as string).getTime() : 0;
      if (now - lastSeen > 172_800_000) continue;          // 48h inactive
      if (now - lastFranky < this.minDelayMs) continue;    // anti-spam
      eligible.push(chatId);
    }

    if (eligible.length === 0) {
      logger.debug('Franky: no eligible chats this cycle');
      return;
    }

    const script = await this.buildConversation();

    for (const chatId of eligible) {
      try {
        await notifier.sendSequence(Number(chatId), script);
        const meta = (await this.store.getChatMetadata(chatId)) ?? {};
        await this.store.saveChatMetadata(chatId, {
          ...meta,
          lastFrankyMessageAt: new Date().toISOString(),
        });
        logger.info({ chatId, steps: script.length }, 'Franky: sent dynamic conversation');
      } catch (err) {
        logger.warn({ chatId, err: String(err) }, 'Franky: send failed');
      }
    }
  }

  private async buildConversation(): Promise<ConversationStep[]> {
    const participants = this.pickParticipants();
    const topic = await this.pickTopic();

    logger.debug({ participants, topic }, 'Franky: generating conversation');

    try {
      const res = await this.llm.chat({
        system: FRANKY_SYSTEM,
        messages: [{
          role: 'user',
          content: `Participants: ${participants.join(', ')}\nTopic: ${topic}`,
        }],
        maxTokens: 600,
      });

      const raw = res.content.replace(/```[a-z]*\n?/gi, '').trim();
      const parsed = JSON.parse(raw) as Array<{ agent: string; text: string; delayMs: number }>;

      if (!Array.isArray(parsed) || parsed.length < 2) throw new Error('invalid structure');

      return parsed.map((step, i) => ({
        agent: (step.agent ?? 'franky') as AgentVoice,
        text: String(step.text ?? '').trim(),
        delayMs: i === 0 ? 0 : Math.max(2000, Math.min(6000, Number(step.delayMs) || 3500)),
      }));
    } catch (err) {
      logger.debug({ err: String(err) }, 'Franky: LLM failed, using scripted fallback');
      const clock = getClockContext();
      return selectScript({ timeOfDay: clock.timeOfDay, dayPeriod: clock.dayPeriod, dayName: clock.dayName });
    }
  }

  private pickParticipants(): string[] {
    const shuffled = [...PARTICIPANTS].sort(() => Math.random() - 0.5);
    const count = 2 + Math.floor(Math.random() * 3); // 2, 3, or 4
    return shuffled.slice(0, count).map(p => String(p));
  }

  private async pickTopic(): Promise<string> {
    // 30% chance of weather-based topic
    if (this.weather && Math.random() < 0.3) {
      const w = await this.weather.getCurrentWeather().catch(() => null);
      if (w) {
        if (w.temperatureCelsius < 20) return `the cold weather (${w.temperatureCelsius}°C outside)`;
        if (w.temperatureCelsius > 30) return `the heat (${w.temperatureCelsius}°C — Sanji won't stop complaining)`;
        return `the pleasant ${w.condition.toLowerCase()} weather today`;
      }
    }
    return TOPICS[Math.floor(Math.random() * TOPICS.length)]!;
  }
}
