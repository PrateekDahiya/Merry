import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Writes context files into the knowledge directory.
 *
 * File naming: every component of the original path is preserved, including
 * the extension (converted to a suffix), so files across repos never collide:
 *
 *   src/index.ts        → src--index-ts.md
 *   src/feed/index.ts   → src--feed--index-ts.md
 *   index.js            → index-js.md          (NOT index.md)
 *   README.md           → overview.md
 *
 * Each file starts with a plain-text metadata block that Nami can match:
 *   # youtube-clone / src/index.ts
 *   repo: youtube-clone | file: src/index.ts | github: PrateekDahiya/youtube-clone
 *
 * This guarantees Robin always knows exactly which repo and file a snippet
 * came from, even when the same filename exists in many repos.
 */
export class KnowledgeWriter {
  constructor(private readonly knowledgeDir: string) {
    mkdirSync(join(knowledgeDir, 'repos'), { recursive: true });
    mkdirSync(join(knowledgeDir, 'interactions'), { recursive: true });
  }

  writeRepoContext(repo: string, filePath: string, content: string): string {
    const repoSlug = repo.split('/').pop() ?? repo;
    const dir = join(this.knowledgeDir, 'repos', repoSlug);
    mkdirSync(dir, { recursive: true });

    const fileName = sanitizePath(filePath) + '.md';
    const fullPath = join(dir, fileName);

    // Prepend a searchable header so Nami can identify source by content
    const header = buildHeader(repo, repoSlug, filePath);
    writeFileSync(fullPath, `${header}\n\n${content}`, 'utf-8');
    return fullPath;
  }

  // ── User profiles ─────────────────────────────────────────────────────────

  writeUserProfile(chatId: string, content: string): string {
    const dir = join(this.knowledgeDir, 'users');
    mkdirSync(dir, { recursive: true });
    const fullPath = join(dir, `${chatId}-profile.md`);
    writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }

  readUserProfile(chatId: string): string | null {
    const filePath = join(this.knowledgeDir, 'users', `${chatId}-profile.md`);
    if (!existsSync(filePath)) return null;
    try {
      return readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  userProfileExists(chatId: string): boolean {
    return existsSync(join(this.knowledgeDir, 'users', `${chatId}-profile.md`));
  }

  // ── Web content ────────────────────────────────────────────────────────────

  writeWebContent(topic: string, source: string, content: string): string {
    const dir = join(this.knowledgeDir, 'web');
    mkdirSync(dir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(topic).slice(0, 60);
    const fileName = `${slug}-${date}.md`;
    const fullPath = join(dir, fileName);

    // Prepend searchable header so Nami can find and identify the source
    const header = `# ${topic}\n\nsource: ${source} | topic: ${topic} | date: ${date}`;
    writeFileSync(fullPath, `${header}\n\n${content}`, 'utf-8');
    return fullPath;
  }

  /** Returns true if a web file for this topic+date already exists (dedup). */
  webContentExists(topic: string): boolean {
    const dir = join(this.knowledgeDir, 'web');
    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(topic).slice(0, 60);
    return existsSync(join(dir, `${slug}-${date}.md`));
  }

  writeInteractionContext(question: string, content: string): string {
    const dir = join(this.knowledgeDir, 'interactions');
    mkdirSync(dir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10);
    const slug = slugify(question).slice(0, 50);
    const fileName = `${date}--${slug}.md`;
    const fullPath = join(dir, fileName);
    writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }
}

/**
 * Converts a GitHub file path to a unique, readable filename stem.
 *
 * Rules:
 *   - README.md / readme.md  → "overview"          (always the repo overview)
 *   - Directory separators   → "--"                 (src/feed.ts → src--feed-ts)
 *   - Extension dots         → "-"                  (feed.ts → feed-ts, NOT feed)
 *   - Remaining special chars → "-"
 *
 * Result examples:
 *   index.ts              → index-ts
 *   index.js              → index-js
 *   src/index.ts          → src--index-ts
 *   api/routes/feed.ts    → api--routes--feed-ts
 *   package.json          → package-json
 */
export function sanitizePath(filePath: string): string {
  if (/^readme\.md$/i.test(filePath)) return 'overview';

  return filePath
    .replace(/\//g, '--')          // directory separator → double dash
    .replace(/\./g, '-')           // dots (incl. extension) → dash (keeps lang suffix)
    .replace(/[^\w-]/g, '-')       // any remaining non-word char → dash
    .replace(/-{2,}(?!-)/g, match => match === '--' ? '--' : '-')  // collapse runs except intentional --
    .replace(/^-+|-+$/g, '')       // trim leading/trailing dashes
    .toLowerCase();
}

function buildHeader(fullRepo: string, repoSlug: string, filePath: string): string {
  return [
    `# ${repoSlug} / ${filePath}`,
    ``,
    `repo: ${repoSlug} | file: ${filePath} | github: ${fullRepo}`,
  ].join('\n');
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join('-');
}
