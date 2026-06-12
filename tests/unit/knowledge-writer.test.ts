import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { sanitizePath, KnowledgeWriter } from '../../src/knowledge/writer.js';

describe('sanitizePath', () => {
  it('converts README.md to overview', () => {
    expect(sanitizePath('README.md')).toBe('overview');
    expect(sanitizePath('readme.md')).toBe('overview');
  });

  it('keeps extension as a suffix so index.ts and index.js differ', () => {
    expect(sanitizePath('index.ts')).toBe('index-ts');
    expect(sanitizePath('index.js')).toBe('index-js');
    expect(sanitizePath('index.py')).toBe('index-py');
  });

  it('uses -- for directory separators', () => {
    expect(sanitizePath('src/feed.ts')).toBe('src--feed-ts');
    expect(sanitizePath('api/routes/feed.ts')).toBe('api--routes--feed-ts');
  });

  it('nested index files stay unique', () => {
    expect(sanitizePath('src/index.ts')).toBe('src--index-ts');
    expect(sanitizePath('src/feed/index.ts')).toBe('src--feed--index-ts');
  });

  it('handles package.json and other dotfiles', () => {
    expect(sanitizePath('package.json')).toBe('package-json');
    expect(sanitizePath('.env.example')).toBe('env-example');
  });

  it('lowercases output', () => {
    expect(sanitizePath('src/MyComponent.tsx')).toBe('src--mycomponent-tsx');
  });
});

describe('KnowledgeWriter — user profiles', () => {
  const testDir = join(tmpdir(), `merry-writer-${Date.now()}`);
  let writer: KnowledgeWriter;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    writer = new KnowledgeWriter(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('writes and reads a user profile round-trip', () => {
    const content = '# User Profile\n- Location: Bangalore\n- Stack: TypeScript';
    const path = writer.writeUserProfile('chat-123', content);
    expect(existsSync(path)).toBe(true);
    expect(writer.readUserProfile('chat-123')).toBe(content);
  });

  it('readUserProfile returns null for non-existent profile', () => {
    expect(writer.readUserProfile('no-such-chat')).toBeNull();
  });

  it('userProfileExists returns false then true after write', () => {
    expect(writer.userProfileExists('chat-456')).toBe(false);
    writer.writeUserProfile('chat-456', 'content');
    expect(writer.userProfileExists('chat-456')).toBe(true);
  });

  it('overwrites profile when written again', () => {
    writer.writeUserProfile('chat-789', 'v1 content');
    writer.writeUserProfile('chat-789', 'v2 content');
    expect(writer.readUserProfile('chat-789')).toBe('v2 content');
  });

  it('creates knowledge/users/ directory automatically', () => {
    writer.writeUserProfile('chat-abc', 'test');
    expect(existsSync(join(testDir, 'users'))).toBe(true);
  });
});
