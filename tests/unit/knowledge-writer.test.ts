import { describe, expect, it } from 'vitest';
import { sanitizePath } from '../../src/knowledge/writer.js';

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
