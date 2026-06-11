import { promises as fs } from 'fs';
import path from 'path';
import { ContextResponse } from '../types/messages.js';

export interface RepositorySearchOptions {
  rootDir?: string;
  maxDepth?: number;
  maxResults?: number;
  maxFileBytes?: number;
}

interface SearchCandidate {
  filePath: string;
  relativePath: string;
  content: string;
}

interface ScoredFinding {
  source: string;
  snippet: string;
  relevance: number;
  rawScore: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_MAX_FILE_BYTES = 80_000;

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'dist',
  'node_modules',
  'coverage',
  '.turbo',
  '.next',
  '.cache',
]);

const SEARCHABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.yml',
  '.yaml',
  '.env',
  '.example',
]);

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'please',
  'the',
  'this',
  'to',
  'with',
]);

export class RepositoryContextSearch {
  private readonly rootDir: string;
  private readonly maxDepth: number;
  private readonly maxResults: number;
  private readonly maxFileBytes: number;

  constructor(options: RepositorySearchOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  async search(taskId: string, query: string): Promise<ContextResponse> {
    const terms = tokenize(query);
    const candidates = await this.collectCandidates(this.rootDir, 0);
    const findings = candidates
      .map(candidate => this.scoreCandidate(candidate, terms))
      .filter((finding): finding is ScoredFinding => finding !== null)
      .sort((a, b) => b.rawScore - a.rawScore)
      .slice(0, this.maxResults)
      .map(({ rawScore: _rawScore, ...finding }) => finding);

    return {
      taskId,
      findings,
      summary: buildSummary(findings.length, terms),
      timestamp: new Date(),
    };
  }

  private async collectCandidates(dir: string, depth: number): Promise<SearchCandidate[]> {
    if (depth > this.maxDepth) {
      return [];
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });
    const candidates: SearchCandidate[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          candidates.push(...(await this.collectCandidates(fullPath, depth + 1)));
        }
        continue;
      }

      if (!entry.isFile() || !isSearchableFile(entry.name)) {
        continue;
      }

      const stat = await fs.stat(fullPath);

      if (stat.size > this.maxFileBytes) {
        continue;
      }

      const content = await fs.readFile(fullPath, 'utf8');
      candidates.push({
        filePath: fullPath,
        relativePath: path.relative(this.rootDir, fullPath),
        content,
      });
    }

    return candidates;
  }

  private scoreCandidate(candidate: SearchCandidate, terms: string[]): ScoredFinding | null {
    const haystack = `${candidate.relativePath}\n${candidate.content}`.toLowerCase();
    const pathHaystack = candidate.relativePath.toLowerCase();
    const matchedTerms = terms.filter(term => haystack.includes(term));

    if (matchedTerms.length === 0) {
      return null;
    }

    const pathMatches = matchedTerms.filter(term => pathHaystack.includes(term)).length;
    const contentMatches = matchedTerms.reduce((count, term) => count + countOccurrences(haystack, term), 0);
    const rawScore = matchedTerms.length * 3 + pathMatches * 4 + Math.min(contentMatches, 20);
    const relevance = Math.min(1, rawScore / 30);

    return {
      source: candidate.relativePath,
      snippet: buildSnippet(candidate.content, matchedTerms),
      relevance: Number(relevance.toFixed(2)),
      rawScore,
    };
  }
}

function isSearchableFile(fileName: string): boolean {
  if (fileName === '.env.example') {
    return true;
  }

  const extension = path.extname(fileName).toLowerCase();
  return SEARCHABLE_EXTENSIONS.has(extension);
}

function tokenize(query: string): string[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .map(term => term.trim())
    .filter(term => term.length > 2)
    .filter(term => !STOP_WORDS.has(term));

  return Array.from(new Set(terms));
}

function countOccurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }

  return count;
}

function buildSnippet(content: string, terms: string[]): string {
  const normalized = content.toLowerCase();
  const firstMatch = terms
    .map(term => normalized.indexOf(term))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstMatch - 160);
  const end = Math.min(content.length, firstMatch + 360);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';

  return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function buildSummary(findingCount: number, terms: string[]): string {
  if (findingCount === 0) {
    return `No local context matched the request terms: ${terms.join(', ') || 'none'}.`;
  }

  return `Found ${findingCount} local context result${findingCount === 1 ? '' : 's'} for: ${terms.join(', ')}.`;
}
