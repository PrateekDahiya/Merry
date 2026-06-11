# Context Service

Phase 4 implements local repository, documentation, and configuration search.

Current modules:

- `repository-search.ts`: recursive text-file scanning, keyword scoring, snippet extraction, and structured `ContextResponse` creation.

The searcher intentionally ignores generated and dependency directories such as `dist`, `node_modules`, and `.git`.
