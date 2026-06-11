# Agents Directory

This directory contains all agent implementations.

## Current Agents (Phase 1 - Skeleton)

- **ace.ts** - Master orchestrator (skeleton)
- **tom.ts** - Telegram interface agent (skeleton)
- **robin.ts** - Writing agent (skeleton)
- **sanji.ts** - Coding agent (skeleton)
- **nami.ts** - Context agent (skeleton)
- **tony.ts** - Health monitoring agent (skeleton)

## Base Class

**base.ts** - Abstract `BaseAgent` class that all agents inherit from.

Provides:
- Task execution lifecycle
- Error handling and logging
- Health check interface
- Result formatting

## Agent Communication

Agents communicate through structured messages:
- Task envelopes from Ace to specialists
- Agent results back to Ace
- Context responses from Nami
- Health reports from Tony

All messages are validated against schemas in `src/types/messages.ts`.

## Extending with New Agents

1. Create a new file: `src/agents/yourAgent.ts`
2. Extend `BaseAgent`
3. Implement `doWork()` method
4. Implement `onStart()` and `onStop()` if needed
5. Register agent in orchestrator
6. Add tests in `tests/agents/`

## Phase 2+ Development

- Phase 2: Implement Tom (Telegram integration)
- Phase 3: Implement Ace (orchestration)
- Phase 5: Implement Robin and Sanji
- Phase 4: Implement Nami (context retrieval)
- Phase 6: Implement Tony (monitoring)
