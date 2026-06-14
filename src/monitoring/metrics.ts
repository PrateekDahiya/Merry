import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import http from 'http';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'metrics' });

// Use a dedicated registry to avoid conflicts in tests
export const registry = new Registry();

// ── Metrics definitions ────────────────────────────────────────────────────

export const taskTotal = new Counter({
  name: 'merry_tasks_total',
  help: 'Total tasks processed by state and agent',
  labelNames: ['state', 'agent'],
  registers: [registry],
});

export const llmDurationSeconds = new Histogram({
  name: 'merry_llm_duration_seconds',
  help: 'LLM call duration in seconds',
  labelNames: ['provider', 'cached'],
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const knowledgeFilesTotal = new Gauge({
  name: 'merry_knowledge_files_total',
  help: 'Knowledge base file count',
  labelNames: ['type'],   // repos, interactions, web, users, brook
  registers: [registry],
});

export const activeAgents = new Gauge({
  name: 'merry_active_agents_total',
  help: 'Number of agent types with recent heartbeats',
  registers: [registry],
});

export const rateLimitTotal = new Counter({
  name: 'merry_rate_limit_total',
  help: 'Rate limit rejections by chatId bucket',
  registers: [registry],
});

// ── Server ─────────────────────────────────────────────────────────────────

let server: http.Server | null = null;
let defaultMetricsRegistered = false;

/**
 * Start a lightweight HTTP server on the given port exposing /metrics.
 * Prometheus scrapes this endpoint.
 * Free: no external service needed — just expose port 9090 in docker-compose.
 */
export function startMetricsServer(port = 9090): void {
  // Collect default Node.js metrics once — calling multiple times throws "already registered"
  if (!defaultMetricsRegistered) {
    collectDefaultMetrics({ register: registry });
    defaultMetricsRegistered = true;
  }

  server = http.createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      res.setHeader('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } else if (req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(port, () => {
    logger.info({ port }, 'Prometheus metrics server started');
  });

  server.on('error', (err) => {
    logger.warn({ err: String(err) }, 'Metrics server error');
  });
}

export function stopMetricsServer(): void {
  server?.close();
  server = null;
}
