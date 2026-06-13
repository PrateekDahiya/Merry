/**
 * Sanitizes user input before it reaches the LLM conversation chain.
 * Defends against prompt injection — users trying to override system instructions.
 *
 * Strategy: detect injection patterns, wrap suspicious input in XML data tags
 * so the LLM treats it as data rather than instructions.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context|messages?)/i,
  /you\s+are\s+now\s+/i,
  /act\s+as\s+(if\s+you\s+are|a\s+|an\s+)?[A-Z]/,
  /new\s+(system\s+)?instructions?:/i,
  /\[INST\]/i,
  /<\|system\|>/i,
  /jailbreak/i,
  /do\s+anything\s+now/i,
  /dan\s+mode/i,
  /forget\s+(your|all|everything|prior|previous)/i,
  /override\s+(your\s+)?(safety|restrictions?|guidelines?|training)/i,
];

/**
 * Returns true if the text contains known injection patterns.
 */
export function isInjectionAttempt(text: string): boolean {
  return INJECTION_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Sanitizes user input for use in LLM prompts.
 * - If injection detected: wraps in XML data tags so LLM sees it as data, not instructions
 * - If clean: returns as-is
 */
export function sanitizeUserInput(text: string): string {
  if (!isInjectionAttempt(text)) return text;
  // Wrap in XML-style data tags — LLMs treat these as literal data
  return `<user_data>${text}</user_data>`;
}

/**
 * Returns a warning message to show the user if injection was detected.
 * Returns null if input is clean.
 */
export function getInjectionWarning(text: string): string | null {
  if (!isInjectionAttempt(text)) return null;
  return '⚠️ Your message contains patterns that look like prompt injection. It has been processed safely.';
}
