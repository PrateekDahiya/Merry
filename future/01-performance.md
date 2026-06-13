# Performance Improvements

## LLM Response Caching

**Problem:** Every message makes 2-3 LLM calls (routing classifier + specialist + optional Zoro enrichment). Repeat questions cost money and add latency.

**Solution:** In-memory LRU cache with TTL.

```typescript
// src/llm/cache.ts
import { createHash } from 'crypto';

interface CacheEntry { content: string; inputTokens: number; outputTokens: number; expiresAt: number }

export class LlmCache {
  private readonly store = new Map<string, CacheEntry>();
  
  key(system: string | undefined, messages: LlmMessage[]): string {
    return createHash('sha256').update(JSON.stringify({ system, messages })).digest('hex').slice(0, 16);
  }
  
  get(key: string): LlmResponse | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return { content: entry.content, inputTokens: entry.inputTokens, outputTokens: entry.outputTokens };
  }
  
  set(key: string, value: LlmResponse, ttlMs = 300_000): void {
    this.store.set(key, { ...value, expiresAt: Date.now() + ttlMs });
  }
}
```

Wrap `AnthropicClient.chat()` and `GroqClient.chat()` to check cache first.
Expected savings: ~70% of LLM calls for common questions.

---

## Nami — Vector Search (Semantic Context)

**Problem:** Keyword search misses semantically related content. "auth middleware" doesn't find files about "JWT validation" or "session management".

**Solution:** Embed knowledge base files + queries using a local model.

**Option A: `@xenova/transformers` (no GPU, runs in-process)**
```typescript
import { pipeline } from '@xenova/transformers';
const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

async function embed(text: string): Promise<number[]> {
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
  const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  return dot / (normA * normB);
}
```

**Option B: Qdrant (separate container, better at scale)**
```yaml
# docker-compose.yml addition
qdrant:
  image: qdrant/qdrant
  ports: ["6333:6333"]
  volumes: ["qdrant_data:/qdrant/storage"]
```

Store embeddings during Zoro indexing. At search time, embed the query, find top-K nearest.

---

## Streaming LLM Responses

**Problem:** User waits 3-10 seconds with no feedback after "Sanji in the kitchen..."

**Solution:** Stream the LLM response and send Telegram chunks as they arrive.

Groq and Anthropic both support streaming. Telegram's `sendMessage` can be called multiple times to update a single message (edit approach).

```typescript
// In GroqClient
async chatStream(request: LlmRequest, onChunk: (text: string) => void): Promise<LlmResponse> {
  const stream = await this.client.chat.completions.create({
    ...params,
    stream: true,
  });
  let full = '';
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? '';
    full += text;
    onChunk(text);
  }
  return { content: full, inputTokens: 0, outputTokens: 0 };
}
```

Ace passes `onChunk` to specialists → specialists stream to Jinbe → Jinbe edits the Telegram message in-place every 500ms.

---

## Zoro — BullMQ Job Queue

**Problem:** Zoro's `setTimeout` loop is fragile. No priority, no visibility, no retry dashboard.

**Solution:** BullMQ (Redis-backed) for Zoro's file processing queue.

```typescript
import { Queue, Worker } from 'bullmq';

const fileQueue = new Queue('zoro-files', { connection: redis });

// Producer: discovery loop adds files
await fileQueue.add('index-file', { repo, filePath }, {
  priority: filePath.match(/readme/i) ? 1 : 10,  // READMEs first
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
});

// Consumer: workers process files
const worker = new Worker('zoro-files', async (job) => {
  await processFile(job.data.repo, job.data.filePath);
}, { connection: redis, concurrency: 3 });
```

Benefits: Bull Board UI shows queue state, automatic retries, priority, delayed jobs.

---

## Webhook Mode (Instead of Long Polling)

**Problem:** `bot.launch()` holds a long-polling connection, wastes memory, 500ms+ latency.

**Solution:** Telegram webhook — Telegram pushes updates to your server instantly.

```typescript
// src/telegram/telegraf-client.ts
async start(): Promise<void> {
  if (process.env.WEBHOOK_URL) {
    await this.bot.launch({
      webhook: {
        domain: process.env.WEBHOOK_URL,
        port: 3000,
        secretToken: process.env.TELEGRAM_WEBHOOK_SECRET,
      }
    });
  } else {
    void this.bot.launch();   // long polling fallback for local dev
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

Add to docker-compose: expose port 3000, put Nginx/Caddy in front with HTTPS.
Latency drop: 500ms → ~50ms.
