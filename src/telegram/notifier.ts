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

  /** Send a character-specific handoff message from Ace to the target crew member. */
  async sendHandoff(chatId: number, toAgent: AgentVoice): Promise<void> {
    if (!this.client) return;
    const pool = HANDOFF_MESSAGES[toAgent];
    if (!pool || pool.length === 0) return;
    const text = pool[Math.floor(Math.random() * pool.length)]!;
    await this.sendRaw(chatId, text);
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
  // Fallback: if LLM returns an unknown agent name, capitalise it rather than show 'undefined'
  const label = AGENT_LABELS[agent] ?? `${String(agent).charAt(0).toUpperCase()}${String(agent).slice(1)}`;
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

// ── Ace handoff messages — sent after routing is decided ──────────────────────
// These replace the generic "figuring out who's best" narration with something
// specific to the destination crew member.

const HANDOFF_MESSAGES: Partial<Record<AgentVoice, string[]>> = {
  sanji: [
    '🔥 *Ace:* Sanji — this one\'s for you. Nobody handles this better.',
    '🔥 *Ace:* That\'s kitchen territory. Calling Sanji now.',
    '🔥 *Ace:* Precision work like this? Sanji\'s the only choice.',
  ],
  robin: [
    '🔥 *Ace:* Robin knows more about this than anyone on the ship. Routing now.',
    '🔥 *Ace:* This calls for Robin\'s library. On it.',
    '🔥 *Ace:* Research and knowledge? Robin\'s already three steps ahead.',
  ],
  jinbe: [
    '🔥 *Ace:* Ocean matters belong to Jinbe. Helmsman, you\'re up!',
    '🔥 *Ace:* That\'s deep sea territory — Jinbe handles this.',
    '🔥 *Ace:* The sea is Jinbe\'s domain. Routing to him now.',
  ],
  tony: [
    '🔥 *Ace:* Medical question? Tony! Don\'t let him hear you call him cute.',
    '🔥 *Ace:* Chopper\'s the best doctor on the seas. Routing to Tony.',
    '🔥 *Ace:* Health and biology? Tony\'s your person. He\'s very serious about it.',
  ],
  nami: [
    '🔥 *Ace:* Nami\'s got the charts and forecasts for this. Sending to her now.',
    '🔥 *Ace:* Weather and maps? Nobody navigates like Nami.',
    '🔥 *Ace:* That\'s Nami\'s specialty. She\'ll have an answer — for a price.',
  ],
  zoro: [
    '🔥 *Ace:* Training and strength? Zoro lives for this. Routing now.',
    '🔥 *Ace:* Zoro\'ll handle this — and probably get lost getting here.',
    '🔥 *Ace:* Fitness and discipline? That\'s Zoro\'s entire personality.',
  ],
  brook: [
    '🔥 *Ace:* Music and culture? Brook\'s domain. Yohoho! Calling him.',
    '🔥 *Ace:* That\'s Brook\'s stage. Soul King incoming.',
    '🔥 *Ace:* Entertainment questions go to Brook. He\'ll probably add a skull pun.',
  ],
  franky: [
    '🔥 *Ace:* Engineering? Franky will say SUPER at least once. Routing now.',
    '🔥 *Ace:* That\'s Franky\'s blueprint territory. SUPER!',
    '🔥 *Ace:* Building and mechanics — Franky\'s got it. He always does.',
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Global singleton so agents can use it without constructor injection
export const notifier = new TelegramNotifier();
