import { describe, expect, it } from 'vitest';
import { summariseUserProfile, isCasualRequest } from '../../src/agents/ace.js';

describe('summariseUserProfile', () => {
  it('returns null for null input', () => {
    expect(summariseUserProfile(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(summariseUserProfile('')).toBeNull();
  });

  it('returns null when no bullet points', () => {
    expect(summariseUserProfile('# Profile\nNo bullets here')).toBeNull();
  });

  it('joins bullet points with pipes', () => {
    const profile = '# Profile\n\n- Location: Bangalore\n- Stack: TypeScript\n- Interests: anime';
    const result = summariseUserProfile(profile);
    expect(result).toBe('Location: Bangalore | Stack: TypeScript | Interests: anime');
  });

  it('caps at 6 bullets', () => {
    const profile = Array.from({ length: 10 }, (_, i) => `- Item ${i}`).join('\n');
    const result = summariseUserProfile(profile)!;
    const count = result.split(' | ').length;
    expect(count).toBeLessThanOrEqual(6);
  });

  it('truncates to 300 chars and appends ...', () => {
    // Each bullet after stripping "- " is 60 chars; 6 bullets × 60 + separators > 300
    const bullets = Array.from({ length: 8 }, (_, i) => `- ${'X'.repeat(55)}${i}`).join('\n');
    const result = summariseUserProfile(bullets)!;
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.endsWith('...')).toBe(true);
  });

  it('strips the leading "- " from bullets', () => {
    const profile = '- Name: Prateek';
    expect(summariseUserProfile(profile)).toBe('Name: Prateek');
  });

  it('ignores lines not starting with dash', () => {
    const profile = 'Random header\n## Section\n- Real bullet\nNot a bullet';
    expect(summariseUserProfile(profile)).toBe('Real bullet');
  });
});

describe('isCasualRequest', () => {
  it('returns true for simple greetings', () => {
    expect(isCasualRequest('hello')).toBe(true);
    expect(isCasualRequest('hi')).toBe(true);
    expect(isCasualRequest('hey')).toBe(true);
  });

  it('returns true for greeting + crew name', () => {
    expect(isCasualRequest('Hi Brook')).toBe(true);
    expect(isCasualRequest('hey sanji')).toBe(true);
    expect(isCasualRequest('hello nami')).toBe(true);
  });

  it('returns false for questions', () => {
    expect(isCasualRequest('how are you?')).toBe(false);
    expect(isCasualRequest('what is fibonacci')).toBe(false);
    expect(isCasualRequest('can you write code')).toBe(false);
  });

  it('returns false for requests longer than 40 chars', () => {
    expect(isCasualRequest('Hi ' + 'x'.repeat(45))).toBe(false);
  });

  it('returns false for messages with more than 4 words', () => {
    expect(isCasualRequest('hey hi hello sup yo there')).toBe(false);
  });

  it('returns false for coding requests', () => {
    expect(isCasualRequest('write a python function')).toBe(false);
    expect(isCasualRequest('debug this error')).toBe(false);
    expect(isCasualRequest('explain recursion')).toBe(false);
  });

  it('returns true for yohoho (One Piece greeting)', () => {
    expect(isCasualRequest('yohoho')).toBe(true);
  });
});
