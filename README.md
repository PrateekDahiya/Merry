# Telegram Multi-Agent Orchestration System

Production-ready Telegram bot architecture for receiving Telegram messages, routing work through Ace, delegating to specialist agents, and returning final responses through Tom.

Current status: Phase 1 is complete. Later phases are represented as skeletons only and are not implemented yet.

## Agents

- Ace: master orchestrator for task routing, agent selection, context coordination, final synthesis, and escalation handling.
- Tom: Telegram interface agent for receiving messages, sending acknowledgments, forwarding to Ace, and returning final answers.
- Robin: writing agent for writing, editing, summarizing, and natural-language responses.
- Sanji: coding agent for implementation, debugging, refactors, and code-specific work.
- Nami: context agent for codebase, docs, config, and local context lookup.
- Tony: watchdog agent for health checks, stuck task detection, and failure reporting.

## Phase 1 Deliverables

Built and working:

- TypeScript project foundation with npm dependency management.
- Environment variable loading through `dotenv`.
- Zod-validated configuration in `src/config/config.ts`.
- Structured Pino logging in `src/logging/logger.ts`.
- Shared message contracts and task lifecycle schemas in `src/types/messages.ts`.
- Error types in `src/types/errors.ts`.
- Base agent class with execution, error handling, lifecycle hooks, and health checks.
- Phase 1 skeleton classes for Ace, Tom, Robin, Sanji, Nami, and Tony.
- In-memory persistence layer for tasks, agent results, and chat metadata.
- Utility ID generation.
- Module boundaries for future Telegram, orchestration, context, and monitoring services.
- Unit tests for configuration, base agents, and persistence.

Not implemented yet:

- Live Telegram bot API integration.
- Real Ace orchestration and dynamic specialist selection.
- Nami repository search.
- Robin/Sanji model-backed specialist execution.
- Tony runtime monitoring loop.
- Durable database persistence.
- Docker/deployment/admin command interface.

## Quick Start

Prerequisites:

- Node.js 18+
- npm
- Telegram bot token from BotFather, once Phase 2 is implemented

Install dependencies:

```bash
npm install
```

Create local environment file:

```bash
npm run setup
```

Run the Phase 1 startup check:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm run test:run
```

Type-check and lint:

```bash
npm run type-check
npm run lint
```

On Windows PowerShell, if script execution policy blocks `npm`, use `npm.cmd`, for example:

```bash
npm.cmd run test:run
```

## Environment Variables

See `.env.example` for the full template.

- `TELEGRAM_BOT_TOKEN`: Telegram bot token. Required by config.
- `TELEGRAM_WEBHOOK_SECRET`: Webhook security token.
- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`.
- `NODE_ENV`: `development`, `production`, or `test`.
- `AGENT_TIMEOUT_MS`: maximum time per agent task.
- `AGENT_MAX_RETRIES`: retry attempts.
- `AGENT_RETRY_DELAY_MS`: retry delay.
- `CONTEXT_SEARCH_DEPTH`: future context traversal depth.
- `CONTEXT_MAX_RESULTS`: future context result limit.
- `TONY_CHECK_INTERVAL_MS`: future watchdog interval.
- `TONY_STUCK_THRESHOLD_MS`: future stuck-task threshold.
- `TASK_MAX_CONCURRENT`: future concurrent task limit.
- `TASK_QUEUE_SIZE`: future queue capacity.
- `TASK_PERSISTENCE_ENABLED`: feature flag for persistence behavior.
- `ADMIN_USER_IDS`: comma-separated Telegram user IDs.
- `USE_MOCK_AGENTS`: feature flag for local mock agents.
- `USE_MOCK_TELEGRAM`: feature flag for local mock Telegram behavior.
- `ENABLE_AUDIT_LOGS`: audit logging flag.
- `ENABLE_TASK_INSPECTION`: task inspection command flag.

## Project Structure

```text
src/
  agents/          Phase 1 agent skeletons and base class
  config/          Environment loading and validation
  context/         Phase 4 context service boundary
  logging/         Logger setup
  monitoring/      Phase 6 monitoring boundary
  orchestrator/    Phase 3 orchestration boundary
  persistence/     In-memory Phase 1 store
  telegram/        Phase 2 Telegram adapter boundary
  types/           Shared schemas and error types
  utils/           Shared utilities
tests/
  unit/            Phase 1 unit tests
```

## Message Contracts

All inter-agent communication is structured around Zod schemas:

- `TaskEnvelope`: task identity, Telegram metadata, lifecycle state, user request, context, constraints, and metadata.
- `AgentResult`: task result wrapper with success state, output, error, timing, and metadata.
- `ContextResponse`: Nami context findings with source paths, snippets, relevance, and summary.
- `HealthReport`: Tony health report for agents and queues.
- `TelegramMessageMeta`: normalized Telegram message metadata.

## Adding New Agents

Create a new class that extends `BaseAgent`, implement `doWork`, and return structured output:

```typescript
import { BaseAgent } from './base.js';
import { TaskEnvelope } from '../types/messages.js';

export class MyAgent extends BaseAgent {
  constructor() {
    super('my-agent-primary', 'my-agent-type');
  }

  protected async doWork(task: TaskEnvelope): Promise<unknown> {
    return { taskId: task.taskId, status: 'ok' };
  }
}
```

Future phases will add Ace registration and routing rules for specialist agents.

## Next Phase

Phase 2 is Telegram entrypoint implementation:

- Implement Tom's Telegram adapter.
- Connect to Telegram bot API.
- Parse incoming Telegram messages.
- Send immediate acknowledgment.
- Create task envelopes and hand them to Ace.
- Support mock mode for local development without live Telegram.
