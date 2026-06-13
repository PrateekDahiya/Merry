# Scaling — Multiple Bots & Multi-Server

## Option A: Multiple Bot Tokens (Start Here)

Run N independent Merry instances, each with its own Telegram bot token.

```bash
# instance 1 — personal bot
TELEGRAM_BOT_TOKEN=111:AAA docker-compose up -d

# instance 2 — team bot (different env file)
TELEGRAM_BOT_TOKEN=222:BBB docker-compose -f docker-compose.team.yml up -d
```

Each instance has its own `merry_data` volume. They can share the same `merry_knowledge` volume (read-only for non-Zoro instances) or have separate ones.

Cost: zero extra infrastructure. Just get more bot tokens from @BotFather.

---

## Option B: chatId Sharding via Redis Queue

One bot token, multiple worker processes handle different users.

```
Telegram → Jinbe (single)
              ↓
         Redis Queue
        /     |     \
   Worker1  Worker2  Worker3
  (Ace+Robin+Sanji)
```

```typescript
// src/sharding/dispatcher.ts
import { Queue, Worker } from 'bullmq';

// Jinbe pushes to queue
const taskQueue = new Queue('tasks', { connection: redis });
await taskQueue.add(`chat-${chatId}`, { chatId, message, taskId }, {
  // Route same chatId to same worker (consistent hashing)
  jobId: `${chatId}-${messageId}`,
});

// Worker processes
const worker = new Worker('tasks', async (job) => {
  const { chatId, message } = job.data;
  const ace = workerPool.getForChat(chatId);  // consistent assignment
  await ace.process(message);
}, { connection: redis, concurrency: 5 });
```

Benefits: 3x throughput, single bot token, users experience no difference.

---

## Option C: Microservices Architecture

Split into independent Docker services communicating via REST/gRPC.

```yaml
# docker-compose.microservices.yml
services:
  telegram-gateway:   # Jinbe — Telegram in/out
    build: .
    command: node dist/services/gateway.js
    
  orchestrator:       # Ace — routing
    build: .
    command: node dist/services/orchestrator.js
    
  specialist-writing: # Robin
    build: .
    command: node dist/services/robin.js
    
  specialist-coding:  # Sanji
    build: .
    command: node dist/services/sanji.js
    
  knowledge-builder:  # Zoro (runs separately, can be on weaker hardware)
    build: .
    command: node dist/services/zoro.js
    
  crew-social:        # Brook + Franky + Luffy proactive messaging
    build: .
    command: node dist/services/crew.js
```

Services communicate via REST (`express`) or gRPC. Knowledge base is a shared volume.
Scale writing/coding specialists independently by chatId demand.

---

## Multi-Server Deployment (Two VMs)

No code changes needed — just a smarter `docker-compose.yml` split.

**VM1 (Chat server — fast SSD, 4+ CPU):**
```yaml
# Handles all user-facing work
services: [telegram-gateway, orchestrator, robin, sanji, nami]
volumes: [merry_data, merry_knowledge (read-write)]
```

**VM2 (Background worker — can be slower/cheaper):**
```yaml
# Background indexing, no user-facing latency requirements
services: [zoro, brook, franky, luffy, tony]
volumes: [merry_knowledge (read-write)]
```

**Shared:** Redis for task queue between VMs. Knowledge volume via NFS mount or S3-backed filesystem (rclone).

---

## Telegram Bot Commands

Register slash commands via Telegraf for in-chat control.

```typescript
// Add to src/telegram/commands.ts
bot.command('status', async (ctx) => {
  const report = await luffy.buildStatusReport();
  await ctx.reply(report);
});

bot.command('reset', async (ctx) => {
  await store.clearChatHistory(String(ctx.chat.id));
  await ctx.reply('🌊 Jinbe: History cleared with honour. Fresh start.');
});

bot.command('zoro', async (ctx) => {
  const stats = zoro.getStats();
  await ctx.reply(`⚔️ Zoro: ${stats.processedFiles} files indexed, ${stats.pendingFiles} pending.`);
});

bot.command('agents', async (ctx) => {
  const statuses = tonyMonitor.getAgentStatuses();
  const lines = statuses.map(s => `${s.healthy ? '✅' : '⚠️'} ${s.agentType}`);
  await ctx.reply('🍖 Luffy: Crew status!\n' + lines.join('\n'));
});

bot.command('help', (ctx) => ctx.reply(`
Crew commands:
/status — Luffy's inspection report
/reset  — Clear your chat history
/zoro   — Knowledge base stats
/agents — Crew health status
/help   — This message
`));
```

Register commands with BotFather so they appear in the menu:
```
/setcommands
status - Luffy's inspection report
reset - Clear your chat history
zoro - Knowledge base stats
agents - Crew health status
```
