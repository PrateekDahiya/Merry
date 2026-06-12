import { TelegramClient } from './types.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'notifier' });

/**
 * TelegramNotifier — lets any agent send a status update to the user mid-flow.
 * Each agent has their own pool of One Piece-flavoured messages so the user
 * knows who is doing what without seeing dry internal logs.
 */
export class TelegramNotifier {
  private client?: TelegramClient;

  setClient(client: TelegramClient): void {
    this.client = client;
  }

  async send(chatId: number, agent: AgentVoice, event: AgentEvent): Promise<void> {
    if (!this.client) return;
    const text = pickMessage(agent, event);
    if (!text) return;
    await this.sendRaw(chatId, labelMessage(agent, text));
  }

  async sendRaw(chatId: number, text: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.sendChatAction(chatId, 'typing');
      await this.client.sendMessage(chatId, text);
    } catch (err) {
      logger.warn({ err: String(err) }, 'Notifier sendRaw failed');
    }
  }

  async sendSequence(chatId: number, steps: ConversationStep[]): Promise<void> {
    for (const step of steps) {
      if (step.delayMs > 0) await sleep(step.delayMs);
      await this.sendRaw(chatId, labelMessage(step.agent, step.text));
    }
  }
}

export type AgentVoice = 'ace' | 'jinbe' | 'nami' | 'robin' | 'sanji' | 'zoro' | 'tony' | 'brook' | 'franky' | 'luffy';

const AGENT_LABELS: Record<AgentVoice, string> = {
  ace:    '🔥 Ace',
  jinbe:  '🌊 Jinbe',
  nami:   '🗺️ Nami',
  robin:  '📖 Robin',
  sanji:  '🍳 Sanji',
  zoro:   '⚔️ Zoro',
  tony:   '🦌 Tony',
  brook:  '🎵 Brook',
  franky: '🔧 Franky',
  luffy:  '🍖 Luffy',
};

function labelMessage(agent: AgentVoice, text: string): string {
  const label = AGENT_LABELS[agent];
  // Strip any leading emoji(s) from the message (the label already adds the emoji)
  // Then strip any remaining "Name: " or "Name " prefix
  const clean = text
    .replace(/^[🔥🌊🗺️📖🍳⚔️🦌🎵🔧🍖⚓]+\s*/u, '')   // strip leading emoji(s)
    .replace(/^\w+[:\s]+/, '')                             // strip "Name: " or "Name " if present
    .trimStart();
  return `*${label}:* ${clean}`;
}

export interface ConversationStep {
  agent: AgentVoice;
  text: string;
  delayMs: number;
}
export type AgentEvent =
  | 'routing'
  | 'fetching_context'
  | 'context_ready'
  | 'working'
  | 'done'
  | 'error'
  | 'approval_needed';

const MESSAGES: Record<AgentVoice, Partial<Record<AgentEvent, string[]>>> = {
  luffy: {
    working: [
      "🍖 Luffy checking on the crew!",
      "🍖 Captain's inspection time! Is everyone working?!",
    ],
    done: [
      "🍖 My crew is strong! All good! GOMU GOMU NO!",
    ],
    error: [
      "🍖 Oi! Something's wrong! I need to check on the crew!",
    ],
  },
  franky: {
    working: [
      "🔧 SUPER! Franky is building a conversation! 💪",
      "🔧 FRANKY POSE! The crew is about to chat!",
    ],
    done: [
      "🔧 SUPER conversation assembled! That's what being SUPER is all about!",
    ],
    error: [
      "🔧 The blueprint had an error! Not SUPER! But I'll fix it!",
    ],
  },
  brook: {
    working: [
      "🎵 Brook reading the web... Yohoho! 💀",
      "🎵 Fetching news from the seas of the internet! 💀",
    ],
    done: [
      "🎵 Brook has returned with findings! Yohoho! 💀",
    ],
    error: [
      "🎵 The seas were rough! I could not retrieve the content! 💀",
    ],
  },
  jinbe: {
    working: [
      "🌊 Jinbe at the helm — message is in safe hands.",
      "🌊 With honour, I'll see this through.",
    ],
    done: [
      "🌊 Jinbe: delivered with honour. Mission complete.",
      "🌊 Steady as the sea. Done.",
    ],
    error: [
      "🌊 Jinbe: something went wrong. I will not let this stand without correction.",
    ],
  },
  ace: {
    routing: [
      '🔥 Ace here — reading the situation and picking the right person for this.',
      '🔥 On it. Let me figure out who\'s best suited to handle this.',
      '🔥 Analysing the request. The crew will take care of it.',
    ],
    done: [
      '🔥 Ace: mission complete. Here\'s what the crew came up with.',
      '🔥 All done. The Straw Hats deliver.',
    ],
    error: [
      '🔥 Ace: something went wrong on our end. I won\'t let it slide twice.',
      '🔥 This one slipped through. My fault — I\'ll fix it.',
    ],
    approval_needed: [
      '🔥 Hold up — this needs my sign-off before we proceed. One wrong move and there\'s no going back.',
    ],
  },

  nami: {
    fetching_context: [
      '🗺️ Nami charting the course — reading the winds and pulling up what I know...',
      '🗺️ Leave navigation to me. Cross-referencing your repos and notes now.',
      '🗺️ I know exactly where to look. Give me a moment.',
    ],
    context_ready: [
      '🗺️ Nami: found the intel. Passing it to the crew.',
      '🗺️ Charts are ready. The team has what they need.',
      '🗺️ I\'ve mapped it out. The rest is up to them.',
    ],
  },

  robin: {
    working: [
      '📖 Robin: processing your request... *turns pages calmly*',
      '📖 Interesting. Give me a moment to compose a proper response.',
      '📖 I\'ve seen things like this before. Let me put it clearly.',
    ],
    done: [
      '📖 Robin: here is what I found.',
      '📖 The archaeology of this question is complete.',
    ],
    error: [
      '📖 Robin: I couldn\'t get a clear answer this time. That\'s... unusual.',
    ],
  },

  sanji: {
    working: [
      '🍳 Sanji in the kitchen — your request is being prepared with full attention.',
      '🍳 Every detail matters. I\'m working on this like a signature dish.',
      '🍳 Don\'t rush a masterpiece. Almost there.',
    ],
    done: [
      '🍳 Sanji: served. This is some of my finest work.',
      '🍳 The dish is ready. Bon appétit.',
    ],
    error: [
      '🍳 Sanji: the recipe failed. That should not happen in my kitchen.',
    ],
  },

  zoro: {
    working: [
      '⚔️ Zoro: indexing your files. No detours.',
      '⚔️ Nothing gets past three swords. Reading everything.',
      '⚔️ Cutting through the noise. This will take focus.',
    ],
    done: [
      '⚔️ Zoro: knowledge forged. The crew can use it now.',
      '⚔️ Done. The map is complete... probably.',
    ],
    error: [
      '⚔️ Zoro: ran into something. I\'ll handle it.',
      '⚔️ Obstacle. I\'ve faced worse.',
    ],
  },

  tony: {
    working: [
      '🦌 Tony here — running a health check on the crew.',
      '🦌 I\'m monitoring everything. The crew is in good hands!',
      '🦌 (Don\'t call me cute — I\'m doing a serious diagnostic!)',
    ],
    done: [
      '🦌 Tony: all clear! All crew members are in good health!',
      '🦌 Doctor\'s report: healthy! (And NOT cute — I\'m a doctor!)',
    ],
    error: [
      '🦌 Tony: EMERGENCY — a crew member needs immediate attention!',
      '🦌 Tony\'s diagnosis: something is critically wrong. Reporting to Ace now!',
    ],
  },
};

function pickMessage(agent: AgentVoice, event: AgentEvent): string | null {
  const pool = MESSAGES[agent]?.[event];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Global singleton so agents can use it without constructor injection
export const notifier = new TelegramNotifier();
