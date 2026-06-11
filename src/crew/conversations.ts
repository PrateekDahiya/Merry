import { ConversationStep, AgentVoice } from '../telegram/notifier.js';
import { LlmClient } from '../llm/client.js';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'crew-conversations' });

export interface ConversationContext {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  dayPeriod: 'weekday' | 'weekend';
  dayName: string;
  temperatureCelsius?: number;
  condition?: string;
}

export type ConversationScript = ConversationStep[];

// ── Scripted conversations ────────────────────────────────────────────────────

const MORNING_COFFEE: ConversationScript = [
  { agent: 'sanji', delayMs: 0,    text: "🍳 Morning. Coffee's on. Espresso, pour-over, or are you one of those people who wants oat milk?" },
  { agent: 'zoro',  delayMs: 3500, text: "⚔️ Black. No sugar. Already done 200 reps." },
  { agent: 'nami',  delayMs: 3000, text: "🗺️ Oat milk flat white, thank you. And good morning — charts are already updated." },
  { agent: 'robin', delayMs: 4500, text: "📖 Chamomile, please. I've been reading since five. The archives don't close." },
  { agent: 'sanji', delayMs: 3000, text: "🍳 Coming right up. Zoro — nobody is impressed." },
  { agent: 'zoro',  delayMs: 2500, text: "⚔️ I impressed myself. That's enough." },
];

const COLD_WEATHER: ConversationScript = [
  { agent: 'sanji', delayMs: 0,    text: "🍳 It is genuinely freezing. I'm making hot soup. No arguments." },
  { agent: 'zoro',  delayMs: 4000, text: "⚔️ Cold builds character. I've trained in worse." },
  { agent: 'nami',  delayMs: 3000, text: "🗺️ Zoro, nobody asked. Sanji — yes please, whatever you're making." },
  { agent: 'tony',  delayMs: 4500, text: "🦌 Tony here: hypothermia is not a joke! Warm layers, everyone. DOCTOR'S ORDERS." },
  { agent: 'robin', delayMs: 5000, text: "📖 I've read about civilisations that thrived in these temperatures. They had better coats than Zoro." },
  { agent: 'sanji', delayMs: 3500, text: "🍳 Soup in twenty minutes. Robin — which civilisations?" },
];

const HOT_WEATHER: ConversationScript = [
  { agent: 'nami',  delayMs: 0,    text: "🗺️ Official navigator's warning: it is way too hot. Do not go outside without water." },
  { agent: 'sanji', delayMs: 3500, text: "🍳 Chilled gazpacho. Iced tea. Nobody is eating anything warm today. Final answer." },
  { agent: 'zoro',  delayMs: 3000, text: "⚔️ The heat is fine. Good for endurance training." },
  { agent: 'nami',  delayMs: 2500, text: "🗺️ You are going to pass out, Zoro." },
  { agent: 'zoro',  delayMs: 3000, text: "⚔️ ...I'll take the iced tea." },
  { agent: 'tony',  delayMs: 3500, text: "🦌 Two litres minimum today! And Zoro — I saw that. Don't think I didn't." },
];

const EVENING_WIND_DOWN: ConversationScript = [
  { agent: 'robin', delayMs: 0,    text: "📖 Another day. Did everyone accomplish what they set out to do?" },
  { agent: 'sanji', delayMs: 4000, text: "🍳 I cooked something excellent. So yes." },
  { agent: 'zoro',  delayMs: 3500, text: "⚔️ Three sessions. Lost count of the reps. Good day." },
  { agent: 'nami',  delayMs: 4000, text: "🗺️ Three new routes mapped and logged. I track everything." },
  { agent: 'ace',   delayMs: 5000, text: "🔥 Ace: crew check done. All present. Rest well — tomorrow we go again." },
];

const WEEKEND_BANTER: ConversationScript = [
  { agent: 'nami',  delayMs: 0,    text: "🗺️ It's the weekend. Official no-stress zone. I've declared it." },
  { agent: 'zoro',  delayMs: 3500, text: "⚔️ I don't recognise weekends. The sword doesn't take days off." },
  { agent: 'sanji', delayMs: 3000, text: "🍳 Absolutely no one is surprised, Zoro." },
  { agent: 'robin', delayMs: 5000, text: "📖 I'm spending the day with a book I can't put down. Don't interrupt." },
  { agent: 'tony',  delayMs: 4000, text: "🦌 REST IS RECOVERY. Please everyone rest. Especially you, Zoro." },
  { agent: 'zoro',  delayMs: 3500, text: "⚔️ Fine. One nap. Then training." },
];

const RANDOM_BANTER: ConversationScript[] = [
  [
    { agent: 'nami',  delayMs: 0,    text: "🗺️ Ace, I've been optimising the routes again. Saved twelve minutes per round trip." },
    { agent: 'ace',   delayMs: 4000, text: "🔥 Nami, you've been 'optimising' for three days. At some point this is just the route." },
    { agent: 'nami',  delayMs: 3000, text: "🗺️ When it's perfect." },
    { agent: 'sanji', delayMs: 4000, text: "🍳 I respect this. A dish is never done until it's perfect." },
    { agent: 'zoro',  delayMs: 3500, text: "⚔️ Ridiculous. Both of you." },
  ],
  [
    { agent: 'tony',  delayMs: 0,    text: "🦌 Crew wellness check: everyone is technically fine but Zoro is ignoring his rest schedule. Again." },
    { agent: 'zoro',  delayMs: 3500, text: "⚔️ I rest when I'm done." },
    { agent: 'tony',  delayMs: 3000, text: "🦌 You are NEVER done, Zoro. That is the PROBLEM." },
    { agent: 'robin', delayMs: 5000, text: "📖 Tony is medically correct. I have references." },
    { agent: 'zoro',  delayMs: 4000, text: "⚔️ Fine. Thirty minutes." },
  ],
  [
    { agent: 'sanji', delayMs: 0,    text: "🍳 Trying a new recipe. Experimental. All I'll say is: trust the process." },
    { agent: 'ace',   delayMs: 4000, text: "🔥 Last time you said that we couldn't identify half the ingredients." },
    { agent: 'sanji', delayMs: 3000, text: "🍳 That was avant-garde. This is different." },
    { agent: 'nami',  delayMs: 4000, text: "🗺️ Full ingredient list before I taste anything. In writing." },
    { agent: 'robin', delayMs: 5000, text: "📖 I'll taste it. I've consumed stranger things in the field." },
  ],
  [
    { agent: 'zoro',  delayMs: 0,    text: "⚔️ Has anyone seen my third sword? I left it somewhere." },
    { agent: 'nami',  delayMs: 3500, text: "🗺️ Zoro. You were HOLDING it twenty minutes ago." },
    { agent: 'sanji', delayMs: 3000, text: "🍳 It's on the table next to your plate. Which you also left." },
    { agent: 'zoro',  delayMs: 2500, text: "⚔️ I knew that." },
    { agent: 'tony',  delayMs: 4000, text: "🦌 I'm starting to think the getting-lost thing is a cry for help." },
  ],
];

let banterIndex = 0;

export function selectScript(ctx: ConversationContext): ConversationScript {
  const temp = ctx.temperatureCelsius;

  if (ctx.timeOfDay === 'morning') return MORNING_COFFEE;
  if (ctx.timeOfDay === 'evening') return EVENING_WIND_DOWN;
  if (temp !== undefined && temp < 20) return COLD_WEATHER;
  if (temp !== undefined && temp > 30) return HOT_WEATHER;
  if (ctx.dayPeriod === 'weekend') return WEEKEND_BANTER;

  const script = RANDOM_BANTER[banterIndex % RANDOM_BANTER.length]!;
  banterIndex++;
  return script;
}

// ── LLM-generated conversation ────────────────────────────────────────────────

const GEN_SYSTEM = `You are writing a casual group-chat conversation for a Telegram channel, between six Straw Hat Pirates characters:
- Ace 🔥 — calm orchestrator, big-brother energy, confident
- Nami 🗺️ — sharp navigator, witty, practical, money-smart
- Robin 📖 — quiet archaeologist, dry wit, occasionally dark humour
- Sanji 🍳 — passionate chef, perfectionist, dramatic about cooking
- Zoro ⚔️ — relentless swordsman, blunt, always slightly lost, secretly caring
- Tony 🦌 — earnest doctor, enthusiastic, offended when called cute

Rules (STRICT):
1. Return ONLY a raw JSON array — no markdown, no explanation, no code fences.
2. 3 to 5 message objects total.
3. Each object: { "agent": "<name lowercase>", "text": "<message>", "delayMs": <number> }
4. First object must have "delayMs": 0. Remaining: 2500 to 5000.
5. Each message is one to two short sentences. Start with the character's emoji.
6. Reflect the context. Sound natural and in-character.
7. Valid agent names: ace, nami, robin, sanji, zoro, tony.`;

export async function generateLlmConversation(
  llm: LlmClient,
  ctx: ConversationContext,
): Promise<ConversationScript | null> {
  const contextLine = [
    `Time: ${ctx.timeOfDay} (${ctx.dayName}, ${ctx.dayPeriod})`,
    ctx.temperatureCelsius !== undefined ? `Weather: ${ctx.temperatureCelsius}°C, ${ctx.condition}` : null,
  ].filter(Boolean).join(' | ');

  try {
    const res = await llm.chat({
      system: GEN_SYSTEM,
      messages: [{ role: 'user', content: `Context: ${contextLine}\n\nWrite the conversation.` }],
      maxTokens: 600,
    });

    const raw = res.content.replace(/```[a-z]*\n?/gi, '').trim();
    const parsed = JSON.parse(raw) as Array<{ agent: string; text: string; delayMs: number }>;

    if (!Array.isArray(parsed) || parsed.length < 2) return null;

    return parsed.map((step, i) => ({
      agent: (step.agent ?? 'ace') as AgentVoice,
      text: String(step.text ?? '').trim(),
      delayMs: i === 0 ? 0 : Math.max(2000, Math.min(6000, Number(step.delayMs) || 3500)),
    }));
  } catch (err) {
    logger.debug({ err: String(err) }, 'LLM conversation generation failed, using scripted fallback');
    return null;
  }
}
