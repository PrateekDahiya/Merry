# Agent Capabilities — What They Can Do Next

## Sanji — Sandboxed Code Execution

When user asks "run this" or "test this code", Sanji actually executes it.

```typescript
// src/agents/sanji-executor.ts
import { execSync } from 'child_process';

async function runPython(code: string, timeoutMs = 10_000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const escapedCode = code.replace(/'/g, "'\\''");
  try {
    const stdout = execSync(
      `docker run --rm --network none --memory 128m --cpus 0.5 python:3.11-alpine python -c '${escapedCode}'`,
      { timeout: timeoutMs, encoding: 'utf-8' }
    );
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.status ?? 1 };
  }
}
```

Sanji detects "run", "execute", "test this" in user request → runs code → returns output in response.
Security: `--network none` (no internet), `--memory 128m` (no memory bomb), `--rm` (cleanup).

Supported languages: Python, Node.js, Bash (all via Docker images).

---

## Robin — Document Upload & Analysis

Telegraf supports `message.document` events. Robin reads PDFs, Word docs, and text files.

```typescript
// src/telegram/telegraf-client.ts — add document handler
this.bot.on('document', async (ctx) => {
  const doc = ctx.message.document;
  if (!doc.file_id) return;
  
  const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
  const buffer = await fetch(fileUrl.toString()).then(r => r.arrayBuffer());
  const text = await extractText(doc.mime_type, Buffer.from(buffer));
  
  // Create a fake message with the document content
  await handler({
    ...normalizeMessage(ctx),
    text: `[Document: ${doc.file_name}]\n\n${text}\n\nUser message: ${ctx.message.caption ?? 'Analyse this document'}`,
  });
});

async function extractText(mimeType: string, buffer: Buffer): Promise<string> {
  if (mimeType === 'application/pdf') {
    const { default: pdfParse } = await import('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text.slice(0, 8000);  // first 8k chars
  }
  if (mimeType.includes('text')) {
    return buffer.toString('utf-8').slice(0, 8000);
  }
  return '[Unsupported document type]';
}
```

---

## Ace — Multi-Step Task Plans

For complex requests like "build a full REST API with auth, tests, and documentation":

```typescript
// src/agents/ace-planner.ts
async function decomposeTask(userRequest: string, llm: LlmClient): Promise<string[]> {
  const res = await llm.chat({
    system: `Break this complex request into 2-5 independent subtasks.
Return ONLY a JSON array of strings. Each string is one subtask.
If the request is simple (1 step), return a single-element array.`,
    messages: [{ role: 'user', content: userRequest }],
    maxTokens: 300,
  });
  return JSON.parse(res.content) as string[];
}

// In Ace.doWork():
const subtasks = await decomposeTask(task.userRequest, this.llm);
if (subtasks.length > 1) {
  const results = [];
  for (const subtask of subtasks) {
    const subResult = await this.processSubtask(subtask, task);
    results.push(subResult);
  }
  return this.synthesizeMultiStepResult(subtasks, results);
}
```

---

## Nami — Real-Time GitHub File Fetch

Currently Nami only searches Zoro's indexed (possibly stale) copies. Add live fetch:

```typescript
// When user says "show me the current auth.ts" or references a specific file
if (mentionsSpecificFile(task.userRequest)) {
  const file = await fetchCurrentGitHubFile(repo, filePath, githubToken);
  findings.push({ source: `github:live:${repo}/${filePath}`, snippet: file, relevance: 0.99 });
}
```

---

## Zoro — External Documentation Sources

Zoro already indexes GitHub repos. Next: index official docs.

```typescript
// src/agents/zoro-docs.ts
const DOC_SOURCES = [
  { name: 'mdn-javascript', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference', topics: ['javascript', 'js'] },
  { name: 'python-docs', url: 'https://docs.python.org/3/library/', topics: ['python'] },
  { name: 'typescript-handbook', url: 'https://www.typescriptlang.org/docs/handbook/', topics: ['typescript', 'ts'] },
  { name: 'react-docs', url: 'https://react.dev/reference/react', topics: ['react', 'hooks'] },
];

// When user asks Python question → Zoro checks if Python docs are indexed → fetches if not
```

---

## Franky — Pattern-Aware Conversations

Current: random topic + random participants every N minutes.
Next: Franky notices what the user cares about.

```typescript
// Track topic frequency from interactions
const topTopics = await getTopTopicsForChat(chatId, 7);  // last 7 days
// ['python', 'typescript', 'onepiece', 'anime']

// Franky picks topics weighted by user's interests
const topic = topTopics.length > 0 && Math.random() < 0.5
  ? `${topTopics[0]} and how it relates to the crew's adventures`
  : TOPICS[Math.floor(Math.random() * TOPICS.length)];
```

Milestone messages:
```typescript
const taskCount = await store.countTasksByChatId(chatId);
if (taskCount === 100 || taskCount === 500 || taskCount === 1000) {
  await notifier.sendRaw(chatId, 
    `🍖 Luffy: OI! You've sent ${taskCount} messages to the crew! That's nakama spirit! GOMU GOMU NO!!`
  );
}
```
