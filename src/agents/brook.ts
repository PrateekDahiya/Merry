import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';
import { LlmClient } from '../llm/client.js';
import { ChatMetadataStore } from '../persistence/store.js';
import { notifier, ConversationStep } from '../telegram/notifier.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'brook' });

export interface BrookOptions {
  store: ChatMetadataStore;
  llm?: LlmClient;
  knowledgeDir: string;
  onepieceIntervalMs?: number;
  animeIntervalMs?: number;
  musicIntervalMs?: number;
  newsIntervalMs?: number;
  singIntervalMs?: number;
  minDelayMs?: number;
  inactiveThresholdMs?: number;
  llmChance?: number;
}

interface RedditPost {
  title: string;
  url: string;
  score: number;
  selftext?: string;
}

// ── Scripted message pools ────────────────────────────────────────────────────

const ONE_PIECE_REACTIONS = [
  '🎵 YOHOHO! New One Piece content has appeared! My bones are trembling with excitement! 💀',
  '🎵 Luffy news! I would cry tears of joy — but I have no eyes! Yohoho! 💀',
  '🎵 The latest chapter is here! What a fine day to be a skeleton! 💀',
  '🎵 One Piece update! Even in death I follow every chapter! YOHOHO! 💀',
];

const ANIME_REACTIONS = [
  '🎵 Yohoho! A new episode has aired! The world of anime never sleeps — much like myself! 💀',
  '🎵 Anime news! I consumed it eagerly, despite having no stomach! YOHOHO! 💀',
  '🎵 The anime world stirs! I would widen my eyes in excitement but... well. Yohoho! 💀',
];

const MUSIC_REACTIONS = [
  '🎵 New music in the world! I myself have been composing — for a skeleton, my repertoire is REMARKABLE! Yohoho! 💀',
  '🎵 The music world stirs! Even in death I am passionate about music! 💀',
  '🎵 New releases! I listened with great enthusiasm — despite having no ears! YOHOHO! 💀',
];

const SONGS = [
  '🎵 *Bink\'s Sake, yo-ho-ho, Bink\'s Sake!* 💀 Yohoho!',
  '🎵 Waves and winds, my eternal companions... though I cannot feel them! Yohoho! 💀',
  '🎵 ♪ Even in the darkness the stars still shine... much like my gleaming skull! YOHOHO! 💀',
  '🎵 Soul King Brook, performing live! I cannot see you — I have no eyes — but I feel your energy! 💀',
  '🎵 *strums guitar with bone fingers* Music is the soul of the seas! Yohoho! 💀',
  '🎵 ♪ Yo-ho-ho and a bottle of milk! Because I am a skeleton and cannot drink sake! YOHOHO! 💀',
  '🎵 La la la~ I have been singing for fifty years alone. The acoustics in the ocean are EXCELLENT! 💀',
];

const CHEERS = [
  '🎵 YOHOHO! What a splendid day to be alive! Not that I would know — I\'m a skeleton! 💀',
  '🎵 I have returned from my reading adventures! Did you miss me? YOHOHO! 💀',
  '🎵 Brook here, reporting for duty! All bones accounted for! 💀',
  '🎵 Just wanted to say — you are all wonderful! I can tell, despite having no eyes! Yohoho! 💀',
];

// ── BrookAgent ────────────────────────────────────────────────────────────────

/**
 * Brook — Soul King, skeleton musician, and the crew's cheerful news herald.
 *
 * Runs 5 independent background loops:
 *   onePieceLoop  — reads r/OnePiece, announces chapters/episodes
 *   animeLoop     — reads r/anime, shares episode releases
 *   musicLoop     — reads r/Music, announces new releases
 *   newsLoop      — reads r/worldnews, co-presents headline with Robin
 *   singLoop      — randomly sings songs and sends cheers to the chat
 *
 * Stores curated content in knowledge/brook/ so Nami and Robin have context.
 * Uses LLM (30% chance) to craft in-character reactions to real content.
 * YOHOHO! 💀
 */
export class BrookAgent extends BaseAgent {
  private active = false;
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly store: ChatMetadataStore;
  private readonly llm?: LlmClient;
  private readonly knowledgeDir: string;
  private readonly minDelayMs: number;
  private readonly llmChance: number;
  private readonly intervals: {
    onepiece: number;
    anime: number;
    music: number;
    news: number;
    sing: number;
  };

  constructor(options: BrookOptions) {
    super('brook-primary', 'brook');
    this.store = options.store;
    this.llm = options.llm;
    this.knowledgeDir = options.knowledgeDir;
    this.minDelayMs = options.minDelayMs ?? 900_000;             // 15 min
    this.llmChance = options.llmChance ?? 0.3;
    this.intervals = {
      onepiece: options.onepieceIntervalMs ?? 14_400_000,
      anime:    options.animeIntervalMs    ?? 14_400_000,
      music:    options.musicIntervalMs    ?? 21_600_000,
      news:     options.newsIntervalMs     ?? 7_200_000,
      sing:     options.singIntervalMs     ?? 5_400_000,
    };
  }

  start(): void {
    if (this.active) return;
    this.active = true;

    // Stagger loops so they don't all fire at the same second.
    // Sing loop fires first (10s), then others every 8s after that.
    this.startLoop(this.intervals.sing,     () => this.singLoop(),     10_000);
    this.startLoop(this.intervals.news,     () => this.newsLoop(),     18_000);
    this.startLoop(this.intervals.onepiece, () => this.onePieceLoop(), 26_000);
    this.startLoop(this.intervals.anime,    () => this.animeLoop(),    34_000);
    this.startLoop(this.intervals.music,    () => this.musicLoop(),    42_000);

    logger.info(
      { intervals: this.intervals, minDelayMs: this.minDelayMs },
      'Brook started — Yohoho! 💀'
    );
  }

  stop(): void {
    this.active = false;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    logger.info('Brook stopped — farewell, cruel world! (I\'m already dead.) 💀');
  }

  protected async doWork(_task: TaskEnvelope): Promise<unknown> {
    return { status: 'ok', active: this.active };
  }

  // ── Loop management ─────────────────────────────────────────────────────────

  private startLoop(intervalMs: number, handler: () => Promise<void>, firstFireMs = 60_000): void {
    const fire = () => {
      if (!this.active) return;
      void handler().catch(err => {
        logger.warn({ err: String(err) }, 'Brook loop error');
      }).finally(() => {
        if (this.active) {
          const jitter = (Math.random() - 0.5) * 0.5 * intervalMs;
          const next = Math.max(60_000, intervalMs + jitter);
          this.timers.push(setTimeout(fire, next));
        }
      });
    };
    // First fire uses the provided short delay, subsequent fires use the full interval
    this.timers.push(setTimeout(fire, firstFireMs));
  }

  // ── Content loops ───────────────────────────────────────────────────────────

  private async onePieceLoop(): Promise<void> {
    const posts = await this.fetchReddit('OnePiece', 'new', 5);
    if (posts.length === 0) return;

    const post = posts.find(p => p.score > 20) ?? posts[0]!;
    const message = await this.buildReaction(
      'One Piece',
      post.title,
      ONE_PIECE_REACTIONS,
    );

    await this.sendToChats([{ agent: 'brook', text: message, delayMs: 0 }]);
    this.writeKnowledge('onepiece', `# One Piece — ${post.title}\n\n${post.selftext ?? ''}\n\nURL: ${post.url}`);
    logger.info({ title: post.title }, 'Brook: One Piece loop fired');
  }

  private async animeLoop(): Promise<void> {
    const posts = await this.fetchReddit('anime', 'hot', 5);
    if (posts.length === 0) return;

    const post = posts.find(p => p.score > 50) ?? posts[0]!;
    const message = await this.buildReaction('anime', post.title, ANIME_REACTIONS);

    await this.sendToChats([{ agent: 'brook', text: message, delayMs: 0 }]);
    this.writeKnowledge('anime', `# Anime News — ${post.title}\n\nURL: ${post.url}`);
    logger.info({ title: post.title }, 'Brook: anime loop fired');
  }

  private async musicLoop(): Promise<void> {
    const posts = await this.fetchReddit('Music', 'hot', 5);
    if (posts.length === 0) return;

    const post = posts.find(p => p.score > 100) ?? posts[0]!;
    const message = await this.buildReaction('music', post.title, MUSIC_REACTIONS);

    await this.sendToChats([{ agent: 'brook', text: message, delayMs: 0 }]);
    this.writeKnowledge('music', `# Music News — ${post.title}\n\nURL: ${post.url}`);
    logger.info({ title: post.title }, 'Brook: music loop fired');
  }

  private async newsLoop(): Promise<void> {
    const posts = await this.fetchReddit('worldnews', 'hot', 3);
    if (posts.length === 0) return;

    const post = posts.find(p => p.score > 100) ?? posts[0]!;
    const headline = post.title;

    // News gets the full Robin-conversation treatment
    const steps: ConversationStep[] = [
      { agent: 'brook', text: '🎵 Yohoho! I have been reading the morning news! Allow me to deliver a headline with flair!', delayMs: 0 },
      { agent: 'robin', text: '📖 *looks up from her book* What did you find, Brook?', delayMs: 3500 },
      { agent: 'brook', text: `🎵 "${headline}" — YOHOHO! What do you make of that? 💀`, delayMs: 4000 },
      { agent: 'robin', text: '📖 ...Fascinating. Or concerning. Possibly both.', delayMs: 5000 },
    ];

    await this.sendToChats(steps);
    this.writeKnowledge('news', `# World News — ${headline}\n\nURL: ${post.url}`);
    logger.info({ title: headline }, 'Brook: news loop fired');
  }

  private async singLoop(): Promise<void> {
    const pool = Math.random() < 0.6 ? SONGS : CHEERS;
    const message = pool[Math.floor(Math.random() * pool.length)]!;
    logger.info({ preview: message.substring(0, 60) }, 'Brook: sing loop firing');
    await this.sendToChats([{ agent: 'brook', text: message, delayMs: 0 }]);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async buildReaction(
    topic: string,
    title: string,
    fallbackPool: string[],
  ): Promise<string> {
    if (this.llm && Math.random() < this.llmChance) {
      try {
        const res = await this.llm.chat({
          system: `You are Brook — Soul King, skeleton musician of the Straw Hat Pirates. Yohoho!
React to this ${topic} news in Brook's voice: enthusiastic, full of skull/bone puns, utterly delighted.
One to two sentences. Start with 🎵. Include "Yohoho!" somewhere. End with 💀.
Return ONLY the message text — no JSON, no quotes.`,
          messages: [{ role: 'user', content: `News title: "${title}"` }],
          maxTokens: 150,
        });
        const text = res.content.trim();
        if (text.length > 10) return text;
      } catch {
        // fall through to scripted
      }
    }

    const base = fallbackPool[Math.floor(Math.random() * fallbackPool.length)]!;
    // Append the actual title so it's informative even in scripted mode
    return `${base}\n📰 "${title}"`;
  }

  private async fetchReddit(subreddit: string, sort: string, limit: number): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${subreddit}.json?sort=${sort}&limit=${limit}`;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'merry-telegram-bot/1.0 (+https://github.com/PrateekDahiya/Merry)',
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        logger.warn({ subreddit, status: res.status }, 'Brook: Reddit fetch failed');
        return [];
      }

      const json = await res.json() as {
        data: {
          children: Array<{
            data: { title: string; url: string; score: number; selftext?: string };
          }>;
        };
      };

      return json.data.children
        .map(c => c.data)
        .filter(p => p.title && p.score > 0);
    } catch (err) {
      logger.warn({ subreddit, err: String(err) }, 'Brook: Reddit fetch error');
      return [];
    }
  }

  private async sendToChats(steps: ConversationStep[]): Promise<void> {
    const chatIds = await this.store.listAllChatIds();
    logger.info({ chatCount: chatIds.length }, 'Brook: checking eligible chats');

    if (chatIds.length === 0) {
      logger.warn('Brook: no chats in store — set ADMIN_CHAT_IDS=<your_chat_id> and rebuild');
      return;
    }

    const now = Date.now();
    let sent = 0;

    for (const chatId of chatIds) {
      const meta = await this.store.getChatMetadata(chatId);
      if (!meta) continue;

      const lastBrook = meta['lastBrookMessageAt'] ? new Date(meta['lastBrookMessageAt'] as string).getTime() : 0;
      const waitMs = this.minDelayMs - (now - lastBrook);

      if (waitMs > 0) {
        logger.info({ chatId, waitMs: Math.round(waitMs / 1000) + 's' }, 'Brook: chat throttled, skipping');
        continue;
      }

      try {
        await notifier.sendSequence(Number(chatId), steps);
        await this.store.saveChatMetadata(chatId, {
          ...meta,
          lastBrookMessageAt: new Date().toISOString(),
        });
        sent++;
        logger.info({ chatId }, 'Brook: message sent');
      } catch (err) {
        logger.warn({ chatId, err: String(err) }, 'Brook: send failed');
      }
    }

    if (sent === 0) {
      logger.info('Brook: no messages sent this cycle');
    }
  }

  private writeKnowledge(topic: string, content: string): void {
    try {
      const dir = join(this.knowledgeDir, 'brook');
      mkdirSync(dir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      writeFileSync(join(dir, `${topic}-${date}.md`), content, 'utf-8');
    } catch (err) {
      logger.warn({ topic, err: String(err) }, 'Brook: knowledge write failed');
    }
  }
}
