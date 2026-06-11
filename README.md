# Telegram Multi-Agent Orchestration System

Production-ready Telegram bot architecture for receiving Telegram messages, routing work through Ace, delegating to specialist agents, and returning final responses through Tom.

Current status: Phase 5 is complete. Telegram entrypoint behavior, Ace orchestration, Nami local context retrieval, and specialist worker contracts are implemented; monitoring and durable persistence are still future phases.

## Agents

- Ace: master orchestrator for task routing, agent selection, context coordination, final synthesis, and escalation handling.
- Tom: Telegram interface agent for receiving messages, sending acknowledgments, forwarding to Ace, and returning final answers.
- Robin: writing agent for writing, editing, summarizing, and natural-language responses.
- Sanji: coding agent for implementation, debugging, refactors, and code-specific work.
- Nami: context agent for codebase, docs, config, and local context lookup.
- Tony: watchdog agent for health checks, stuck task detection, and failure reporting.

## Completed Deliverables

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
- Tom Telegram entrypoint behavior.
- Telegraf-backed Telegram client.
- Incoming text message parsing into normalized Telegram metadata.
- Immediate typing action plus `Checking...` acknowledgment.
- Task envelope creation from Telegram messages.
- In-memory message deduplication by chat/message ID.
- Telegram-to-Ace dispatcher that runs Ace and returns the synthesized response to Tom.
- Long response splitting for Telegram's message length limit.
- Mockable Telegram client and dispatcher interfaces.
- Unit tests for Telegram formatting and Tom's receive/ack/dispatch flow.
- Ace orchestration flow.
- Dynamic specialist routing between Robin and Sanji using deterministic rules.
- Task lifecycle transitions through `running`, `waiting_for_context`, `delegated`, `completed`, and `failed`.
- Nami context request step with a structured placeholder response.
- Specialist delegation and result persistence.
- Final response synthesis by Ace.
- Telegram dispatcher now returns Ace's final response to Tom.
- Unit tests for routing, lifecycle completion/failure, and dispatcher response flow.
- Nami local context retrieval over repository, docs, and config text files.
- Recursive search with ignored generated/dependency directories.
- Keyword scoring, relative source paths, snippets, relevance scores, and summaries.
- Runtime wiring for `CONTEXT_SEARCH_DEPTH` and `CONTEXT_MAX_RESULTS`.
- Unit tests for context ranking, ignored directories, no-match behavior, and Nami structured responses.
- Robin and Sanji specialist workers with distinct prompt templates and structured outputs.
- Specialist output schema for `title`, `response`, `summary`, `nextSteps`, `warnings`, and `prompt`.
- Ace synthesis of structured specialist results into final Telegram-ready text.
- Unit tests for Robin and Sanji output structure.

Not implemented yet:

- Tony runtime monitoring loop.
- Durable database persistence.
- Docker/deployment/admin command interface.

## Quick Start

Prerequisites:

- Node.js 18+
- npm
- Telegram bot token from BotFather for live Telegram mode

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

By default `.env.example` uses `USE_MOCK_TELEGRAM=true`, so startup initializes the app without connecting to Telegram. To run the live Telegram listener, set:

```bash
TELEGRAM_BOT_TOKEN=your_real_bot_token
USE_MOCK_TELEGRAM=false
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
  context/         Phase 4 local context search service
  logging/         Logger setup
  monitoring/      Phase 6 monitoring boundary
  orchestrator/    Phase 3 routing, result contracts, and Telegram-to-Ace dispatch
  persistence/     In-memory Phase 1 store
  telegram/        Phase 2 Telegram adapter, formatting, and task factory
  types/           Shared schemas and error types
  utils/           Shared utilities
tests/
  unit/            Phase 1 through Phase 5 unit tests
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

Register the new specialist in Ace's `specialistFactories` and update `selectSpecialistAgent` when it should be routable.

## Example Telegram Flow

With `USE_MOCK_TELEGRAM=false`, Tom starts a Telegraf polling listener:

1. Telegram user sends a text message to the bot.
2. Tom receives the update and normalizes chat ID, message ID, user ID, sender names, timestamp, text, and reply metadata.
3. Tom sends a typing action and replies `Checking...`.
4. Tom creates a `TaskEnvelope` assigned to Ace.
5. The Telegram-to-Ace dispatcher runs Ace.
6. Ace asks Nami for repository context, selects Robin or Sanji, delegates the task, and synthesizes the final response.
7. Tom sends Ace's final response back to Telegram.

## Next Phase

Phase 6 is monitoring implementation:

- Implement Tony's runtime health checks and heartbeats.
- Track queue latency, task age, stuck jobs, and repeated failures.
- Emit diagnostics to Ace without modifying task content.
- Add tests for stuck-task detection and health report generation.
