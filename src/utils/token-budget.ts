/**
 * Token budget utilities for managing LLM context window limits.
 *
 * Uses a conservative 4 chars-per-token estimate (typical English text is
 * 3.5–4.5 chars/token for GPT/Llama tokenizers). Slightly underestimating
 * gives a small safety buffer before hitting the hard limit.
 */

const CHARS_PER_TOKEN = 4;

/** Rough estimate: 1 token ≈ 4 chars of English text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Truncates text to fit within maxTokens. Appends '...' if truncated.
 * Guaranteed to produce a string of at most (maxTokens × CHARS_PER_TOKEN) chars.
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

export interface ChainEntry {
  agent: string;
  content: string;
}

/** Default token budget for the conversation chain passed to specialists.
 *  16k total window − ~2k response − ~1k system prompt = 13k; use 12k for safety. */
export const MESSAGES_TOKEN_BUDGET = 12_000;

const ENTRY_SEPARATOR = '\n\n';

function chainToText(chain: ChainEntry[]): string {
  return chain.map(e => `[${e.agent}]: ${e.content}`).join(ENTRY_SEPARATOR);
}

/**
 * Compresses a conversation chain to fit within maxTokens.
 *
 * Drop / truncate order (least critical first):
 *   1. [ace] routing note      — internal metadata; specialist doesn't need it
 *   2. [user profile]          — truncated to 300 tokens (keeps key facts)
 *   3. [prev user/assistant]   — oldest history entries dropped first
 *   4. [nami context]          — truncated to remaining budget, never dropped
 *   5. [user] current request  — truncated only as absolute last resort, never dropped
 *
 * @param chain      Tagged conversation entries (order matters — oldest first)
 * @param maxTokens  Token budget for the entire formatted chain (default 12 000)
 */
export function compressChain(chain: ChainEntry[], maxTokens = MESSAGES_TOKEN_BUDGET): ChainEntry[] {
  if (chain.length === 0) return chain;
  if (estimateTokens(chainToText(chain)) <= maxTokens) return chain;

  let result = [...chain];

  // 1. Drop [ace] routing note — internal, specialist doesn't need it
  const aceIdx = result.findIndex(e => e.agent === 'ace');
  if (aceIdx >= 0) {
    result.splice(aceIdx, 1);
    if (estimateTokens(chainToText(result)) <= maxTokens) return result;
  }

  // 2. Truncate [user profile] to 300 tokens
  const profileIdx = result.findIndex(e => e.agent === 'user profile');
  if (profileIdx >= 0 && estimateTokens(result[profileIdx]!.content) > 300) {
    result[profileIdx] = { ...result[profileIdx]!, content: truncateToTokens(result[profileIdx]!.content, 300) };
    if (estimateTokens(chainToText(result)) <= maxTokens) return result;
  }

  // 3. Drop oldest [prev user] / [prev assistant] entries until under budget
  while (estimateTokens(chainToText(result)) > maxTokens) {
    const firstPrev = result.findIndex(e => e.agent === 'prev user' || e.agent === 'prev assistant');
    if (firstPrev < 0) break;
    result.splice(firstPrev, 1);
  }
  if (estimateTokens(chainToText(result)) <= maxTokens) return result;

  // 4. Truncate [nami context] to fill remaining budget
  const namiIdx = result.findIndex(e => e.agent === 'nami context');
  if (namiIdx >= 0) {
    const withoutNami = chainToText(result.filter((_, i) => i !== namiIdx));
    const separatorTokens = Math.ceil(ENTRY_SEPARATOR.length / CHARS_PER_TOKEN);
    const namiBudget = maxTokens - estimateTokens(withoutNami) - separatorTokens - 10;
    if (namiBudget >= 100) {
      result[namiIdx] = { ...result[namiIdx]!, content: truncateToTokens(result[namiIdx]!.content, namiBudget) };
    } else {
      result.splice(namiIdx, 1);
    }
    if (estimateTokens(chainToText(result)) <= maxTokens) return result;
  }

  // 5. Last resort: truncate the current [user] request — never drop it
  let userIdx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i]!.agent === 'user') { userIdx = i; break; }
  }
  if (userIdx >= 0) {
    const withoutUser = chainToText(result.filter((_, i) => i !== userIdx));
    const separatorTokens = Math.ceil(ENTRY_SEPARATOR.length / CHARS_PER_TOKEN);
    const userBudget = Math.max(maxTokens - estimateTokens(withoutUser) - separatorTokens - 10, 200);
    result[userIdx] = { ...result[userIdx]!, content: truncateToTokens(result[userIdx]!.content, userBudget) };
  }

  return result;
}
