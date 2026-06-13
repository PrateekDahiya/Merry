# Architecture Improvements

## SQLite Store (Replace JSON File Store)

**Problem:** JSON file store reads/writes the entire file on every operation. No indices. Concurrent writes can corrupt it under load.

**Solution:** SQLite via `better-sqlite3` — zero infrastructure, single file, 100x faster.

```typescript
// src/persistence/sqlite-store.ts
import Database from 'better-sqlite3';

export class SqliteStore implements TaskStore, ResultStore, ChatMetadataStore {
  private readonly db: Database.Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');  // concurrent reads
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }
  
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        state TEXT NOT NULL,
        user_request TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL  -- full JSON
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_chat ON tasks(chat_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
      
      CREATE TABLE IF NOT EXISTS results (
        task_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS chat_metadata (
        chat_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }
  
  async listTasksByChatId(chatId: string, limit = 50): Promise<TaskEnvelope[]> {
    const rows = this.db.prepare(
      'SELECT data FROM tasks WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(chatId, limit) as { data: string }[];
    return rows.map(r => JSON.parse(r.data) as TaskEnvelope).reverse();
  }
}
```

Migration: run `FileStore` → read all data → write to `SqliteStore`. One-time migration script in `scripts/migrate-to-sqlite.ts`.

---

## Event-Driven Agent Communication

**Problem:** Agents call each other directly (Ace calls Nami, Nami calls GitHub API, Ace calls Sanji). Tight coupling, hard to test, impossible to distribute.

**Solution:** EventEmitter2 for in-process (same server) or Redis Pub/Sub for multi-server.

```typescript
// src/events/bus.ts
import EventEmitter2 from 'eventemitter2';

export const bus = new EventEmitter2({ wildcard: true });

// Jinbe emits when message arrives
bus.emit('message.received', { chatId, message, taskId });

// Ace listens
bus.on('message.received', async ({ chatId, message, taskId }) => {
  // route and process
  bus.emit('task.routed', { taskId, agent: 'sanji' });
});

// Sanji listens
bus.on('task.routed', async ({ taskId, agent }) => {
  if (agent !== 'sanji') return;
  // do work
  bus.emit('task.completed', { taskId, response });
});
```

For multi-server: replace `bus.emit` with `redis.publish`, `bus.on` with `redis.subscribe`.

---

## Plugin Agent System

**Problem:** Adding a new specialist requires modifying `ace.ts`, `types/messages.ts`, `routing.ts`, `index.ts`, `notifier.ts`. Too many files.

**Solution:** Self-registering agent plugins.

```typescript
// src/agents/registry.ts
export interface AgentPlugin {
  type: string;
  description: string;
  emoji: string;
  matches?: (request: string) => boolean;
  factory: (llm: LlmClient) => BaseAgent;
}

class AgentRegistry {
  private plugins = new Map<string, AgentPlugin>();
  
  register(plugin: AgentPlugin): void {
    this.plugins.set(plugin.type, plugin);
  }
  
  getAll(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }
  
  findByType(type: string): AgentPlugin | undefined {
    return this.plugins.get(type);
  }
}

export const registry = new AgentRegistry();

// Each agent file self-registers:
// src/agents/usopp.ts
registry.register({
  type: 'usopp',
  description: 'Long-range analysis and creative problem solving',
  emoji: '🎯',
  factory: (llm) => new UsoppAgent(llm),
});
```

Ace uses `registry.getAll()` instead of hardcoded factories. Routing includes all registered agents. Notifier adds emoji from plugin definition automatically.

---

## Circuit Breaker for External APIs

**Problem:** If Groq goes down, every request fails with a slow timeout. If GitHub rate-limits, Zoro hammers it with 429s.

**Solution:** Circuit breaker pattern.

```typescript
// src/utils/circuit-breaker.ts
type State = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private state: State = 'closed';
  private failures = 0;
  private nextAttempt = 0;
  
  constructor(
    private readonly name: string,
    private readonly failureThreshold = 5,
    private readonly resetTimeMs = 30_000,
  ) {}
  
  async call<T>(fn: () => Promise<T>, fallback?: () => T): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() < this.nextAttempt) {
        if (fallback) return fallback();
        throw new Error(`${this.name} circuit open — service unavailable`);
      }
      this.state = 'half-open';
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }
  
  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }
  
  private onFailure(): void {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.nextAttempt = Date.now() + this.resetTimeMs;
    }
  }
}

// Usage:
const groqBreaker = new CircuitBreaker('groq', 5, 30_000);
await groqBreaker.call(() => groqClient.chat(request), () => ({ content: 'mock fallback', ... }));
```

One breaker per external service: `groqBreaker`, `githubBreaker`, `wikipediaBreaker`, `ddgBreaker`.
