# Observability — Logs, Metrics, Tracing

## Correlation IDs (Quick Win — 2 hours)

Every task already has a `taskId`. Ensure it propagates to ALL log lines for that task.

```typescript
// src/logging/logger.ts — add child logger with taskId
export function createTaskLogger(taskId: string) {
  return getLogger().child({ correlationId: taskId });
}
```

Every agent that processes a task uses `createTaskLogger(task.taskId)` instead of a generic logger. Then:
```bash
docker-compose logs | grep '"correlationId":"task-1781211240"'
# Shows every log line from Jinbe → Ace → Nami → Sanji → Jinbe for that one request
```

---

## Prometheus Metrics

Add a `/metrics` endpoint using `prom-client`.

```typescript
// src/monitoring/metrics.ts
import { Counter, Histogram, Gauge, register } from 'prom-client';

export const taskTotal = new Counter({
  name: 'merry_tasks_total',
  help: 'Total tasks by state',
  labelNames: ['state', 'agent'],
});

export const llmDuration = new Histogram({
  name: 'merry_llm_duration_seconds',
  help: 'LLM call duration',
  labelNames: ['provider', 'model'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

export const knowledgeFiles = new Gauge({
  name: 'merry_knowledge_files_total',
  help: 'Knowledge base file count by type',
  labelNames: ['type'],  // repos, interactions, web, users
});

// Expose endpoint:
import http from 'http';
http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.end(await register.metrics());
  }
}).listen(9090);
```

Add to `docker-compose.yml`:
```yaml
ports: ["9090:9090"]
```

---

## Grafana Dashboard

Sample dashboard panels:
- **Response time p50/p95** — `histogram_quantile(0.95, merry_llm_duration_seconds)`
- **Tasks per minute** — `rate(merry_tasks_total[1m])`
- **Agent distribution** — pie chart of `merry_tasks_total` by agent
- **Knowledge base growth** — `merry_knowledge_files_total` over time
- **Error rate** — tasks with state=failed / total

```yaml
# docker-compose.yml additions
prometheus:
  image: prom/prometheus
  volumes: ["./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml"]
  
grafana:
  image: grafana/grafana
  ports: ["3001:3000"]
  volumes: ["grafana_data:/var/lib/grafana"]
```

`monitoring/prometheus.yml`:
```yaml
scrape_configs:
  - job_name: merry
    static_configs:
      - targets: ['merry:9090']
    scrape_interval: 15s
```

---

## OpenTelemetry Distributed Tracing

When running multiple services, see exactly where time is spent.

```typescript
// src/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

const sdk = new NodeSDK({
  traceExporter: new JaegerExporter({ endpoint: 'http://jaeger:14268/api/traces' }),
  serviceName: 'merry',
});
sdk.start();
```

Add spans manually for key operations:
```typescript
const tracer = trace.getTracer('merry');
const span = tracer.startSpan('llm.chat');
try {
  const result = await llm.chat(request);
  span.setStatus({ code: SpanStatusCode.OK });
  return result;
} catch (err) {
  span.recordException(err as Error);
  throw err;
} finally {
  span.end();
}
```

---

## Sentry Error Tracking

```bash
npm install @sentry/node
```

```typescript
// src/index.ts
import * as Sentry from '@sentry/node';
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

// Replace logger.error calls:
logger.error(err, 'Fatal error');
Sentry.captureException(err);
```

Add `SENTRY_DSN` to `.env` and docker-compose. Free tier handles 5k errors/month.

---

## Structured Log Analysis

Current logs are JSON (pino). To query them:

```bash
# Find all failed tasks in the last hour
docker-compose logs | grep '"state":"failed"' | jq '.taskId'

# Find slow LLM calls (> 5 seconds)
docker-compose logs | grep '"executionTimeMs"' | jq 'select(.executionTimeMs > 5000)'

# Count tasks by agent
docker-compose logs | grep '"msg":"Task completed successfully"' | jq '.agentType' | sort | uniq -c
```

For production: ship logs to Loki (Grafana's log aggregation), query with LogQL.
