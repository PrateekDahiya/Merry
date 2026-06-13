import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'document-handler' });

export interface ExtractedDocument {
  text: string;
  fileName: string;
  mimeType: string;
  truncated: boolean;
}

const MAX_CHARS = 8_000;

/**
 * Extract text from a document buffer.
 * Supports: PDF, plain text, markdown, JSON, CSV, code files.
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ExtractedDocument> {
  logger.debug({ mimeType, fileName, bytes: buffer.length }, 'Extracting document text');

  let text = '';

  if (mimeType === 'application/pdf') {
    text = await extractPdf(buffer);
  } else if (isTextMime(mimeType) || isTextExtension(fileName)) {
    text = buffer.toString('utf-8');
  } else {
    text = `[Document type "${mimeType}" is not supported for text extraction.]`;
  }

  const truncated = text.length > MAX_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_CHARS) + '\n\n[... document truncated ...]' : text,
    fileName,
    mimeType,
    truncated,
  };
}

async function extractPdf(buffer: Buffer): Promise<string> {
  try {
    const mod = await import('pdf-parse');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (mod.default ?? mod) as unknown as (buf: Buffer) => Promise<{ text?: string }>;
    const data = await pdfParse(buffer);
    return data.text ?? '';
  } catch (err) {
    logger.warn({ err: String(err) }, 'PDF parsing failed');
    return '[Could not extract text from PDF]';
  }
}

function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/csv',
    'application/x-yaml',
  ].includes(mime);
}

function isTextExtension(fileName: string): boolean {
  return /\.(txt|md|csv|json|yaml|yml|ts|js|py|rb|go|rs|java|cpp|c|h|sh|bash|sql|html|css|xml)$/i.test(fileName);
}

/**
 * Build the user message text from an extracted document and optional caption.
 */
export function buildDocumentMessage(doc: ExtractedDocument, caption?: string): string {
  const parts = [
    `[Document: ${doc.fileName}]`,
    doc.truncated ? '(truncated to 8000 chars)' : null,
    '',
    doc.text,
    '',
    caption ? `User instruction: ${caption}` : 'Please analyse this document.',
  ];
  return parts.filter(p => p !== null).join('\n');
}
