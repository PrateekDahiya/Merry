# Orchestrator

Phase 3 implements Ace's routing, lifecycle management, delegation, and final synthesis flow.

Current modules:

- `routing.ts`: deterministic specialist selection rules.
- `result.ts`: orchestration result contract and type guard.
- `phase2-dispatcher.ts`: Telegram-to-Ace dispatcher boundary retained from Phase 2 and now backed by real Ace execution.

Phase 4 will replace Nami's placeholder context response with real repository and documentation lookup.
