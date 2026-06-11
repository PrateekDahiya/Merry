const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

export function splitTelegramMessage(
  text: string,
  maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH
): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const candidate = remaining.slice(0, maxLength);
    const splitAt = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
    const boundary = splitAt > Math.floor(maxLength * 0.5) ? splitAt : maxLength;

    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
