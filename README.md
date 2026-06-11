# Telegram Multi-Agent Orchestration System

Production-ready Telegram bot that receives messages, routes work through a master agent (Ace), delegates to specialist agents, gathers results, and returns answers back to Telegram.

## Architecture

- **Ace** — Master orchestrator. Routes tasks, selects agents, coordinates context, synthesizes results.
- **Tom** — Telegram interface. Reads Telegram messages, sends acknowledgments, forwards to Ace.
- **Robin** — Writing agent. Handles writing, editing, summarizing, natural language responses.
- **Sanji** — Coding agent. Handles implementation, debugging, refactoring, code tasks.
- **Nami** — Context agent. Searches codebase, docs, and local sources for relevant context.
- **Tony** — Watchdog. Monitors agent health, detects timeouts/failures, informs Ace.

## Core Features

✅ **Phase 1 - Project Foundation** (COMPLETED)
- Repository structure with modular organization
- Dependency management (npm + TypeScript)
- Environment variable loading via dotenv
- Configuration system with Zod validation
- Structured logging with Pino
- Persistence layer (in-memory in Phase 1)
- Base agent class with lifecycle hooks
- Shared message schemas and error types
- Utility functions for ID generation
- Minimal README and setup instructions

⏳ **Phase 2 - Telegram Entrypoint**
- Implement Tom agent
- Connect to Telegram Bot API
- Handle incoming messages
- Send acknowledgments/reactions
- Queue or hand off to Ace

⏳ **Phase 3 - Orchestration Layer**
- Implement Ace agent
- Task routing and agent selection
- Task lifecycle state management
- Result synthesis

⏳ **Phase 4 - Context Retrieval**
- Implement Nami agent
- Repository/docs/config search
- Structured context responses

⏳ **Phase 5 - Specialist Agents**
- Implement Robin (writing)
- Implement Sanji (coding)
- Prompt templates and output formatting

⏳ **Phase 6 - Health Monitoring**
- Implement Tony agent
- Health checks and heartbeats
- Timeout and failure detection

⏳ **Phase 7 - Reliability & Persistence**
- Database persistence (SQLite/PostgreSQL)
- Task state resumption after restart
- Idempotency and deduplication
- Retry policies and dead-letter handling
- Graceful shutdown

⏳ **Phase 8 - Validation & Tests**
- Unit tests for routing, context, lifecycle, monitoring
- Integration tests for full Telegram flow
- Mock mode for local development

⏳ **Phase 9 - Polish & Deployment**
- Docker support
- Deployment notes and observability
- Admin interface / task inspection commands

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- A Telegram bot token (from @BotFather)

### Installation

```bash
cd Merry
npm install
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```bash
# Required
TELEGRAM_BOT_TOKEN=your_bot_token_here

# Optional (defaults provided)
LOG_LEVEL=debug
NODE_ENV=development
AGENT_TIMEOUT_MS=30000
TASK_MAX_CONCURRENT=10
```

### Run Development Server

```bash
npm run dev
```

### Build for Production

```bash
npm run build
npm start
```

### Run Tests

```bash
npm test           # Watch mode
npm run test:run   # Single run
```

### Linting & Type Checking

```bash
npm run lint
npm run type-check
```

## Project Structure

```
Merry/
├── src/
│   ├── agents/              # Agent implementations (Ace, Tom, Robin, Sanji, Nami, Tony)
│   ├── config/              # Configuration loading and validation
│   ├── logging/             # Pino logger setup
│   ├── types/               # Shared types and schemas
│   │   ├── messages.ts      # Agent message contracts
│   │   └── errors.ts        # Custom error types
│   ├── persistence/         # Task/result storage (in-mem → DB in Phase 7)
│   ├── orchestrator/        # Ace orchestration logic (Phase 3)
│   ├── telegram/            # Telegram integration (Phase 2)
│   ├── context/             # Context service (Phase 4)
│   ├── monitoring/          # Tony monitoring (Phase 6)
│   ├── utils/               # Shared utilities
│   └── index.ts             # Application entry point
├── tests/
│   ├── unit/                # Unit tests
│   └── integration/         # Integration tests
├── .env.example             # Environment variables template
├── package.json             # Dependencies
├── tsconfig.json            # TypeScript config
└── README.md                # This file
```

## Message Contracts

All inter-agent communication is structured and validated with Zod schemas:

```typescript
// Task envelope - sent to agents
TaskEnvelope {
  taskId, chatId, userId, messageId, timestamp,
  state, userRequest, assignedAgent, context, constraints
}

// Agent result - returned from agents
AgentResult {
  taskId, agentId, success, result, error, executionTimeMs
}

// Context response - from Nami
ContextResponse {
  taskId, findings[], summary, timestamp
}

// Health report - from Tony
HealthReport {
  reportedAt, agentStatuses, queueHealth, recommendations
}
```

## Configuration

All configuration via environment variables (see `.env.example`):

**Telegram:**
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_WEBHOOK_SECRET` - Webhook security token

**Logging:**
- `LOG_LEVEL` - debug, info, warn, error (default: info)
- `NODE_ENV` - development, production, test

**Agent Behavior:**
- `AGENT_TIMEOUT_MS` - Max time per task (default: 30000)
- `AGENT_MAX_RETRIES` - Retry attempts (default: 3)
- `AGENT_RETRY_DELAY_MS` - Delay between retries

**Context:**
- `CONTEXT_SEARCH_DEPTH` - How deep to search dirs (default: 3)
- `CONTEXT_MAX_RESULTS` - Max context results (default: 10)

**Monitoring (Tony):**
- `TONY_CHECK_INTERVAL_MS` - Health check frequency (default: 5000)
- `TONY_STUCK_THRESHOLD_MS` - Task stuck threshold (default: 60000)

**Tasks:**
- `TASK_MAX_CONCURRENT` - Parallel tasks (default: 10)
- `TASK_QUEUE_SIZE` - Queue capacity (default: 1000)
- `TASK_PERSISTENCE_ENABLED` - Persist tasks (default: true)

**Admin:**
- `ADMIN_USER_IDS` - Comma-separated Telegram IDs with special access

**Features:**
- `USE_MOCK_AGENTS` - Use mock responses instead of real agents
- `USE_MOCK_TELEGRAM` - Use mock Telegram instead of real bot
- `ENABLE_AUDIT_LOGS` - Log all actions for audit trail
- `ENABLE_TASK_INSPECTION` - Allow querying task status via commands

## Extending with New Agents

To add a new specialist agent:

1. Create `src/agents/myAgent.ts`:

```typescript
import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';

export class MyAgent extends BaseAgent {
  constructor() {
    super('my-agent-id', 'my-agent-type');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    // Your implementation
    return { result: 'success' };
  }
}
```

2. Register in Ace's agent selection logic (Phase 3)
3. Add tests in `tests/agents/myAgent.test.ts`
4. Update orchestrator to route tasks to your agent

## Task Lifecycle

```
received → acknowledged → delegated → running → [waiting_for_context] → completed
                                      ↓
                                    failed
                                      ↓
                                    stuck
                                      ↓
                                   escalated
```

## Roadmap

- ✅ Phase 1: Foundation
- 🔄 Phase 2: Telegram integration
- 🔄 Phase 3: Orchestration
- 🔄 Phase 4: Context retrieval
- 🔄 Phase 5: Specialist agents
- 🔄 Phase 6: Health monitoring
- 🔄 Phase 7: Persistence & reliability
- 🔄 Phase 8: Tests & validation
- 🔄 Phase 9: Deployment & polish

## Development Notes

- All agent-to-agent communication is message-based and structured
- Never bypass Ace - all work routes through master orchestrator
- Tony only monitors; doesn't modify tasks
- Nami only supplies context; doesn't make decisions
- Tom only interfaces with Telegram; doesn't reason
- Each phase should be tested before moving to next
- Use mock modes for local development without Telegram API

## License

MIT
