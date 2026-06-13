# Merry — Future Roadmap

This folder contains the strategic roadmap for the next phases of Merry.

## Current state (June 2026)

Merry is a production-quality, single-server multi-agent Telegram orchestration system with:
- **10 agents**: Ace, Jinbe, Robin, Sanji, Nami, Tony, Zoro, Brook, Franky, Luffy
- **LLM routing**: Groq/Anthropic/Ollama with LLM-based request classification
- **Knowledge base**: GitHub indexing (Zoro) + Wikipedia/web enrichment + interactions
- **Proactive messaging**: Crew chats, news, music, weather-aware conversations
- **Per-user profiles**: Memory of who you are across conversations
- **Chat history**: Last N turns injected into every request

## Three pillars for the future

1. **Scalability** — multiple bot instances, multi-server, distributed agents
2. **Reliability** — better persistence, circuit breakers, observability
3. **Intelligence** — deeper agent capabilities, code execution, vector search

## Documents

| File | Topic |
|---|---|
| [01-performance.md](./01-performance.md) | LLM caching, vector search, webhook mode |
| [02-architecture.md](./02-architecture.md) | Event-driven, SQLite, plugin agents, circuit breakers |
| [03-scaling-multi-bot.md](./03-scaling-multi-bot.md) | Multiple bots, sharding, microservices, bot commands |
| [04-observability.md](./04-observability.md) | Correlation IDs, Prometheus, Grafana, OpenTelemetry |
| [05-agent-capabilities.md](./05-agent-capabilities.md) | Code execution, document upload, multi-step plans |
| [06-security-reliability.md](./06-security-reliability.md) | Rate limiting, prompt injection defense, backups |
| [07-developer-experience.md](./07-developer-experience.md) | Admin dashboard, CI/CD, bot commands, local dev |
| [08-prioritized-roadmap.md](./08-prioritized-roadmap.md) | **Start here** — tiered action list |

## Quick start on what to do next

See **[08-prioritized-roadmap.md](./08-prioritized-roadmap.md)** — Tier 1 items are all high-impact and can be done in days.
