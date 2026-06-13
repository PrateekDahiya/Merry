import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { createChildLogger } from '../logging/logger.js';
import { ContextResponse } from '../types/messages.js';

const logger = createChildLogger({ component: 'vector-search' });

/**
 * Lightweight TF-IDF vector for cosine similarity.
 * No model download required — pure in-process computation.
 * Good for keyword-heavy knowledge base files.
 */
function tokenize(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function buildTfVector(tokens: string[], vocab: string[]): number[] {
  const freq: Record<string, number> = {};
  for (const t of tokens) freq[t] = (freq[t] ?? 0) + 1;
  return vocab.map(v => (freq[v] ?? 0) / tokens.length);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    normA += (a[i] ?? 0) ** 2;
    normB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface VectorSearchOptions {
  rootDir: string;
  maxResults?: number;
  minScore?: number;
}

/**
 * Semantic knowledge base search using TF-IDF vectors.
 * Indexes all .md files in the knowledge directory and searches by cosine similarity.
 * No external service needed — purely in-memory.
 *
 * This replaces keyword matching with semantic similarity, so
 * "auth middleware" finds "JWT validation" even without exact word overlap.
 */
export class VectorContextSearch {
  private docs: Array<{ source: string; content: string; tokens: string[] }> = [];
  private vocab: string[] = [];
  private vectors: number[][] = [];
  private indexed = false;
  private readonly maxResults: number;
  private readonly minScore: number;

  constructor(private readonly options: VectorSearchOptions) {
    this.maxResults = options.maxResults ?? 8;
    this.minScore = options.minScore ?? 0.05;
  }

  /** Build or rebuild the index from disk. Call once at startup. */
  async buildIndex(): Promise<void> {
    const files = this.collectMarkdownFiles(this.options.rootDir);
    logger.info({ files: files.length, rootDir: this.options.rootDir }, 'Building vector index');

    this.docs = files.map(filePath => ({
      source: relative(this.options.rootDir, filePath),
      content: readFileSync(filePath, 'utf-8'),
      tokens: tokenize(readFileSync(filePath, 'utf-8')),
    }));

    // Build vocabulary from all documents
    const vocabSet = new Set<string>();
    for (const doc of this.docs) {
      for (const token of doc.tokens) vocabSet.add(token);
    }
    this.vocab = Array.from(vocabSet).slice(0, 5_000); // cap vocab size

    // Build TF vectors
    this.vectors = this.docs.map(doc => buildTfVector(doc.tokens, this.vocab));
    this.indexed = true;

    logger.info({ docs: this.docs.length, vocabSize: this.vocab.length }, 'Vector index built');
  }

  /** Search the index for documents similar to the query. */
  async search(taskId: string, query: string): Promise<ContextResponse> {
    if (!this.indexed || this.docs.length === 0) {
      return { taskId, findings: [], summary: 'Vector index not ready.', timestamp: new Date() };
    }

    const queryTokens = tokenize(query);
    const queryVec = buildTfVector(queryTokens, this.vocab);

    const scored = this.docs.map((doc, i) => ({
      source: doc.source,
      snippet: doc.content.slice(0, 500),
      relevance: cosineSimilarity(queryVec, this.vectors[i] ?? []),
    }));

    const findings = scored
      .filter(f => f.relevance >= this.minScore)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, this.maxResults);

    return {
      taskId,
      findings,
      summary: findings.length > 0
        ? `Found ${findings.length} semantically similar knowledge file(s).`
        : 'No similar knowledge found.',
      timestamp: new Date(),
    };
  }

  private collectMarkdownFiles(dir: string, depth = 0): string[] {
    if (!existsSync(dir) || depth > 5) return [];
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        files.push(...this.collectMarkdownFiles(full, depth + 1));
      } else if (entry.endsWith('.md') || entry.endsWith('.txt')) {
        files.push(full);
      }
    }
    return files;
  }
}
