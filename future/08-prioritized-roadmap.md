# Prioritized Roadmap — What to Do and When

## How to read this

Items are sorted by **impact × (1/effort)**. Do Tier 1 first — maximum value for minimum work.
Each item links to the relevant detail document.

---

## Tier 1 — High impact, low effort (hours to days)

These improve the system significantly without risky refactors.

| # | Item | Effort | Impact | Doc |
|---|---|---|---|---|
| 1 | **Bot commands** `/status /reset /zoro /agents` | 4 hours | ★★★★☆ | [07-dx.md](./07-developer-experience.md) |
| 2 | **Correlation IDs** in all logs | 2 hours | ★★★★☆ | [04-observability.md](./04-observability.md) |
| 3 | **Rate limiting** per chatId (10 req/min) | 4 hours | ★★★★☆ | [06-security.md](./06-security-reliability.md) |
| 4 | **Prompt injection defense** | 3 hours | ★★★☆☆ | [06-security.md](./06-security-reliability.md) |
| 5 | **Startup config validation** (fail fast) | 2 hours | ★★★☆☆ | [06-security.md](./06-security-reliability.md) |
| 6 | **SQLite store** (replace JSON file) | 2 days | ★★★★★ | [02-architecture.md](./02-architecture.md) |
| 7 | **Automated volume backups** | 3 hours | ★★★★☆ | [06-security.md](./06-security-reliability.md) |

---

## Tier 2 — High impact, medium effort (days)

These significantly change the quality of the system.

| # | Item | Effort | Impact | Doc |
|---|---|---|---|---|
| 8 | **LLM response caching** (in-memory LRU) | 1 day | ★★★★☆ | [01-performance.md](./01-performance.md) |
| 9 | **Sandboxed code execution** (Sanji runs Python) | 2 days | ★★★★★ | [05-capabilities.md](./05-agent-capabilities.md) |
| 10 | **Prometheus metrics** + basic Grafana | 2 days | ★★★★☆ | [04-observability.md](./04-observability.md) |
| 11 | **Webhook mode** (replace long polling) | 1 day | ★★★☆☆ | [01-performance.md](./01-performance.md) |
| 12 | **Document upload** (Robin reads PDFs) | 2 days | ★★★★☆ | [05-capabilities.md](./05-agent-capabilities.md) |
| 13 | **Circuit breakers** for all external APIs | 1 day | ★★★★☆ | [02-architecture.md](./02-architecture.md) |
| 14 | **CI/CD pipeline** (GitHub Actions) | 1 day | ★★★☆☆ | [07-dx.md](./07-developer-experience.md) |

---

## Tier 3 — High impact, high effort (weeks)

Architectural changes that unlock the next level.

| # | Item | Effort | Impact | Doc |
|---|---|---|---|---|
| 15 | **Vector search for Nami** (semantic knowledge) | 3-4 days | ★★★★★ | [01-performance.md](./01-performance.md) |
| 16 | **Plugin agent system** (register without modifying Ace) | 3 days | ★★★★☆ | [02-architecture.md](./02-architecture.md) |
| 17 | **Multi-bot tokens** (Option A — multiple instances) | 1 day | ★★★★☆ | [03-scaling.md](./03-scaling-multi-bot.md) |
| 18 | **Ace multi-step planning** (complex tasks) | 1 week | ★★★★★ | [05-capabilities.md](./05-agent-capabilities.md) |
| 19 | **BullMQ job queue for Zoro** | 3 days | ★★★☆☆ | [01-performance.md](./01-performance.md) |
| 20 | **Event-driven architecture** (EventEmitter2 bus) | 1 week | ★★★★☆ | [02-architecture.md](./02-architecture.md) |
| 21 | **OpenTelemetry tracing** | 3 days | ★★★☆☆ | [04-observability.md](./04-observability.md) |

---

## Tier 4 — Nice to have (backlog)

Do these when the system is humming and you want to go further.

- Admin dashboard (HTML UI on port 3001)
- Group chat support (multiple users in one chat)
- gRPC agent communication (microservices)
- Kubernetes deployment manifests
- Voice synthesis for Brook (TTS)
- Multi-language response support
- Streaming LLM responses (Telegram message editing)
- Sentry error tracking
- chatId sharding via Redis (Option B)
- Microservices split (Option C)

---

## Suggested sprint order

**Sprint 1 (this week):**
Bot commands → Rate limiting → Correlation IDs → Startup validation → SQLite

**Sprint 2 (next week):**
LLM caching → Circuit breakers → CI/CD → Webhook mode

**Sprint 3:**
Vector search for Nami ← biggest quality improvement in the whole roadmap

**Sprint 4:**
Sandboxed code execution → Document upload → Prometheus metrics

**Sprint 5+:**
Multi-step planning, multi-bot, event bus...

---

## One-line rationale for each Tier 1 item

- **Bot commands**: Users can control the bot without admin access to the server
- **Correlation IDs**: Without this, debugging production issues is guesswork  
- **Rate limiting**: One buggy client can overload the whole system right now
- **Prompt injection**: Users can override agent personalities right now
- **Startup validation**: Saves 30 minutes of confusion when a key is missing
- **SQLite**: JSON file store will eventually corrupt under concurrent writes
- **Backups**: You will lose your knowledge base someday — be ready
