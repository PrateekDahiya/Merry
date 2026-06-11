# Telegram Multi-Agent Orchestration System (Merry)

Production-ready Telegram bot that receives messages, routes work through a master orchestrator (Ace), delegates to specialist agents, and returns synthesized responses via Tom.

**Status: Phases 1–9 complete. All 43 tests pass.**

---

## Agents

| Agent | Role |
|-------|------|
| **Ace** | Master orchestrator — routing, context coordination, specialist delegation, synthesis, approval gating |
| **Tom** | Telegram interface — receives messages, sends acknowledgments, forwards to Ace, returns replies |
| **Robin** | Writing specialist — prose, summaries, editing, natural-language responses |
| **Sanji** | Coding specialist — implementation, debugging, refactors, code-specific tasks |
| **Nami** | Context agent — searches repository, docs, and config for relevant snippets |
| **Tony** | Watchdog — monitors task health, detects stuck jobs, alerts Ace |

---

## Quick Start

### Prerequisites
- Node.js 20+
- A Telegram bot token (from [@BotFather](https://t.me/botfather)) for live mode
- An Anthropic API key for real LLM responses (optional; mock mode works without one)

### Install

```bash
npm install
cp .env.example .env   # or: npm run setup
```

Edit `.env` with your tokens.

### Run in mock mode (no Telegram, no API key)

```bash
npm run dev
```

### Run with live Telegram + real LLM

```env
TELEGRAM_BOT_TOKEN=your_bot_token
ANTHROPIC_API_KEY=your_anthropic_key
USE_MOCK_AGENTS=false
USE_MOCK_TELEGRAM=false
```

```bash
npm run dev
```

### Build and start production

```bash
npm run build
npm start
```

### Docker

```bash
docker-compose up -d
```

### Test

```bash
npm run test:run       # run once
npm test               # watch mode
```

### Type-check and lint

```bash
npm run type-check
npm run lint
```

---

## Environment Variables

See `.env.example` for the full template with comments.

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Required. Bot token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | `webhook-secret` | Webhook validation secret |
| `ANTHROPIC_API_KEY` | — | Claude API key. Omit to use mock agents |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Claude model ID |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `PERSISTENCE_TYPE` | `file` | `file` (survives restarts) or `memory` |
| `DB_PATH` | `./data/store.json` | Path for file-backed store |
| `AGENT_TIMEOUT_MS` | `30000` | Per-agent task timeout |
| `CONTEXT_SEARCH_DEPTH` | `3` | Nami directory traversal depth |
| `CONTEXT_MAX_RESULTS` | `10` | Max context findings per query |
| `TONY_CHECK_INTERVAL_MS` | `10000` | Tony health-check poll interval |
| `TONY_STUCK_THRESHOLD_MS` | `60000` | Task age before Tony flags it stuck |
| `ADMIN_USER_IDS` | — | Comma-separated Telegram user IDs with admin access |
| `USE_MOCK_AGENTS` | `false` | Use deterministic stubs instead of real LLM |
| `USE_MOCK_TELEGRAM` | `true` | Skip live Telegram listener |
| `ENABLE_AUDIT_LOGS` | `true` | Structured audit logging |

---

## Project Structure

```
src/
  agents/        Ace, Tom, Robin, Sanji, Nami, Tony + base class
  config/        Zod-validated env loading
  context/       Nami's repository search engine
  llm/           LLM client abstraction (Anthropic + Mock)
  logging/       Pino structured logger
  monitoring/    TonyMonitor — background health check loop
  orchestrator/  Routing, result contracts, Telegram-to-Ace dispatcher
  persistence/   InMemoryStore + FileStore + factory
  telegram/      Telegraf client, message formatting, task factory
  types/         Shared Zod schemas, error types
  utils/         ID generators
tests/
  unit/          Config, agents, routing, persistence, monitoring, specialists
  integration/   Full Telegram → Tom → Ace → specialist → Tom flow
```

---

## Message Contracts

All inter-agent communication uses Zod-validated schemas (`src/types/messages.ts`):

- **`TaskEnvelope`** — task identity, Telegram metadata, lifecycle state (`received → acknowledged → running → waiting_for_context → delegated → awaiting_approval | completed | failed | stuck | escalated | cancelled`)
- **`AgentResult`** — result wrapper with success flag, output, error, and timing
- **`ContextResponse`** — Nami findings with source paths, snippets, and relevance scores
- **`HealthReport`** — Tony's agent status and queue health snapshot
- **`TelegramMessageMeta`** — normalized Telegram message

---

## Message Flow

```
Telegram user sends message
  → Tom receives via Telegraf
    → Tom sends typing action + "Checking..." reply
    → Tom creates TaskEnvelope and dispatches to Ace

Ace orchestrates
  → Nami searches repository for relevant context
  → Ace selects specialist (Robin for writing, Sanji for coding)
  → Ace delegates to specialist with task + context
  → Ace checks if response requires approval (destructive ops)
    → if yes: state → awaiting_approval, response includes approval prompt
    → if no: state → completed
  → Ace synthesizes final response

Tom sends final response back to Telegram
  (splits messages > 4096 chars automatically)

Tony runs in background
  → checks every TONY_CHECK_INTERVAL_MS
  → marks overdue tasks as "stuck"
  → alerts Ace with diagnostic summary
```

---

## Safety: Approval Gate

Ace automatically flags requests that contain destructive keywords (`drop table`, `truncate`, `rm -rf`, `force push`, etc.) and responses where Sanji sets `requiresApproval: true`.

When flagged:
- Task state becomes `awaiting_approval`
- Response includes `⚠️ APPROVAL REQUIRED:` with instructions to reply `approve` or `cancel`

---

## Adding New Agents

1. Extend `BaseAgent` and implement `doWork`:

```typescript
import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';

export class ZoroAgent extends BaseAgent {
  constructor(private readonly llm: LlmClient) {
    super('zoro-primary', 'zoro');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    // Your specialist logic here
    return { taskId: task.taskId, response: '...' };
  }
}
```

2. Add `zoro` to the `AgentType` enum in `src/types/messages.ts`.

3. Register the factory in Ace's `specialistFactories` option.

4. Add routing keywords to `selectSpecialistAgent` in `src/orchestrator/routing.ts`.

---

## Persistence

The default `PERSISTENCE_TYPE=file` uses an atomic JSON file store at `DB_PATH`. Data survives restarts.

For `PERSISTENCE_TYPE=memory`, all state is lost on restart. Useful for ephemeral test runs.

---

## Monitoring

Tony's `TonyMonitor` runs a background interval that:
- Detects tasks stuck in `running`/`delegated` for longer than `TONY_STUCK_THRESHOLD_MS`
- Checks agent heartbeat staleness
- Monitors queue depth
- Emits structured `MonitorAlert` objects to registered handlers (Ace handles them by marking tasks `stuck`)

---

## Development Notes

- Mock mode (`USE_MOCK_AGENTS=true`, `USE_MOCK_TELEGRAM=true`) lets the full system run locally without any external services.
- File store uses a tmp-rename atomic write pattern to avoid corrupt files on crash.
- All agent-to-agent communication is Zod-validated at parse time.
- Message deduplication prevents replaying the same Telegram update.
