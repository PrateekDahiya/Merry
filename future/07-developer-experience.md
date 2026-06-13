# Developer Experience

## Bot Commands (Quick Win)

Register slash commands with Telegraf and BotFather.

```typescript
// src/telegram/commands.ts
export function registerCommands(bot: Telegraf, deps: CommandDeps): void {
  bot.command('status', async (ctx) => {
    const report = await deps.luffy.runNow();
    await ctx.reply(formatReport(report), { parse_mode: 'Markdown' });
  });
  
  bot.command('reset', async (ctx) => {
    await deps.store.clearChatHistory(String(ctx.chat.id));
    await ctx.reply('🌊 Jinbe: Chat history cleared with honour. Fresh slate.');
  });
  
  bot.command('zoro', async (ctx) => {
    const stats = deps.zoro?.getStats();
    if (!stats) return ctx.reply('⚔️ Zoro: Not configured.');
    await ctx.reply(`⚔️ Zoro: ${stats.processedFiles} indexed | ${stats.pendingFiles} pending | ${stats.skippedFiles} skipped`);
  });
  
  bot.command('agents', async (ctx) => {
    const heartbeats = deps.monitor.getAgentStatuses();
    const lines = heartbeats.length > 0
      ? heartbeats.map(h => `${h.healthy ? '✅' : '⚠️'} ${h.agentType} — last seen ${formatAge(h.lastHeartbeat)}`)
      : ['No heartbeats recorded yet'];
    await ctx.reply('🍖 Luffy: Crew check!\n' + lines.join('\n'));
  });
  
  bot.command('help', (ctx) => ctx.reply(`
*Merry Crew Commands*

/status — Captain Luffy's inspection report
/reset  — Clear your conversation history  
/zoro   — Knowledge base stats
/agents — Crew heartbeat status
/help   — This help message
  `, { parse_mode: 'Markdown' }));
}
```

Register with BotFather:
```
/mybots → select bot → Edit Bot → Edit Commands
→ paste:
status - Captain's inspection report
reset - Clear your chat history
zoro - Knowledge base stats
agents - Crew health status
help - Show available commands
```

---

## CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run type-check
      - run: npm run test:run
      - run: npm run lint

# .github/workflows/deploy.yml  
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /opt/merry
            git pull origin main
            docker-compose build --no-cache
            docker-compose up -d
```

---

## Local Development Modes

```json
// package.json additions
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "dev:mock": "USE_MOCK_AGENTS=true USE_MOCK_TELEGRAM=true tsx watch src/index.ts",
    "dev:local-llm": "LLM_PROVIDER=ollama USE_MOCK_TELEGRAM=true tsx watch src/index.ts",
    "scenario": "tsx scripts/run-scenarios.ts",
    "migrate": "tsx scripts/migrate-to-sqlite.ts"
  }
}
```

`scripts/run-scenarios.ts` — send predefined messages to mock Jinbe and assert responses:
```typescript
const scenarios = [
  { input: 'write fibonacci in python', expectedAgent: 'sanji', mustContain: 'def fibonacci' },
  { input: 'Hi Brook', expectedAgent: 'robin', respondAs: 'brook', mustContain: 'Yohoho' },
  { input: 'summarize this for executives', expectedAgent: 'robin' },
];
```

---

## Admin Dashboard

Minimal HTML dashboard served on port 3001:

```typescript
// src/admin/server.ts
import express from 'express';
const app = express();

app.get('/dashboard', (req, res) => res.sendFile('dashboard.html'));

app.get('/api/status', async (req, res) => {
  res.json({
    agents: monitor.getAgentStatuses(),
    tasks: await store.listTasksByState('running'),
    zoro: zoro?.getStats(),
    uptime: process.uptime(),
  });
});

app.get('/api/knowledge', (req, res) => {
  const files = glob.sync('**/*.md', { cwd: knowledgeDir });
  res.json({ files, total: files.length });
});

app.listen(3001);
```

`dashboard.html` — plain HTML with auto-refresh, no framework needed:
```html
<script>
setInterval(async () => {
  const data = await fetch('/api/status').then(r => r.json());
  document.getElementById('status').innerHTML = JSON.stringify(data, null, 2);
}, 5000);
</script>
```

---

## CLAUDE.md (Codebase Documentation)

Run `/init` skill to generate `CLAUDE.md` — comprehensive codebase guide for Claude Code sessions.
Keeps new developers (and Claude) oriented without reading every file.

Key sections:
- Agent roster with responsibilities
- Data flow diagrams
- Environment variable reference
- Common development tasks
- Architecture decisions and why
