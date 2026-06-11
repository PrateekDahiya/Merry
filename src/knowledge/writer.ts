import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Writes context files into the knowledge directory.
 * Naming conventions:
 *   knowledge/repos/{repo-name}/{sanitized-file-path}.md  ← from GitHub files
 *   knowledge/interactions/{date}--{slug}.md              ← from user conversations
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
    writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
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

function sanitizePath(filePath: string): string {
  if (filePath === 'README.md' || filePath.toLowerCase() === 'readme.md') {
    return 'overview';
  }
  return filePath
    .replace(/\//g, '--')      // src/feed.ts  →  src--feed.ts
    .replace(/\.[^.]+$/, '')   // remove extension
    .replace(/[^\w-]/g, '-')   // non-word chars → dash
    .replace(/-+/g, '-')       // collapse multiple dashes
    .toLowerCase();
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
