import { describe, it, expect } from 'vitest';
import { extractDocumentText, buildDocumentMessage } from '../../src/telegram/document-handler.js';

describe('extractDocumentText', () => {
  it('extracts plain text from text/plain', async () => {
    const buffer = Buffer.from('Hello, this is a test document.');
    const result = await extractDocumentText(buffer, 'text/plain', 'test.txt');
    expect(result.text).toContain('Hello');
    expect(result.truncated).toBe(false);
    expect(result.fileName).toBe('test.txt');
  });

  it('extracts JSON as text', async () => {
    const json = JSON.stringify({ name: 'Merry', agents: ['Robin', 'Sanji'] });
    const result = await extractDocumentText(Buffer.from(json), 'application/json', 'data.json');
    expect(result.text).toContain('Robin');
    expect(result.truncated).toBe(false);
  });

  it('extracts markdown by file extension', async () => {
    const md = '# Title\n\nSome **bold** text.';
    const result = await extractDocumentText(Buffer.from(md), 'application/octet-stream', 'readme.md');
    expect(result.text).toContain('Title');
  });

  it('truncates long documents', async () => {
    const longText = 'x'.repeat(10_000);
    const result = await extractDocumentText(Buffer.from(longText), 'text/plain', 'big.txt');
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(10_000);
    expect(result.text).toContain('[... document truncated ...]');
  });

  it('returns unsupported message for unknown binary', async () => {
    const result = await extractDocumentText(Buffer.from([0, 1, 2]), 'application/octet-stream', 'file.bin');
    expect(result.text).toContain('not supported');
  });

  it('extracts Python code files by extension', async () => {
    const code = 'def hello():\n    print("world")';
    const result = await extractDocumentText(Buffer.from(code), 'application/octet-stream', 'script.py');
    expect(result.text).toContain('def hello');
  });
});

describe('buildDocumentMessage', () => {
  it('includes filename and text', () => {
    const msg = buildDocumentMessage({
      text: 'Document content here',
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      truncated: false,
    });
    expect(msg).toContain('notes.txt');
    expect(msg).toContain('Document content here');
    expect(msg).toContain('analyse');
  });

  it('includes caption when provided', () => {
    const msg = buildDocumentMessage(
      { text: 'content', fileName: 'f.txt', mimeType: 'text/plain', truncated: false },
      'Summarise this'
    );
    expect(msg).toContain('Summarise this');
  });

  it('mentions truncation when truncated', () => {
    const msg = buildDocumentMessage({
      text: 'short',
      fileName: 'big.txt',
      mimeType: 'text/plain',
      truncated: true,
    });
    expect(msg).toContain('truncated');
  });
});
