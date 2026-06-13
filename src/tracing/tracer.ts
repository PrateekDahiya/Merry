import { trace, Span, SpanStatusCode } from '@opentelemetry/api';
import { createChildLogger } from '../logging/logger.js';

const logger = createChildLogger({ component: 'tracer' });

let initialized = false;

/**
 * Initialize OpenTelemetry tracing.
 *
 * Development/default: uses ConsoleSpanExporter (logs to stdout).
 * Production: set OTEL_EXPORTER_OTLP_ENDPOINT to export to Jaeger/Tempo/Datadog.
 *
 * Free alternatives:
 *   - Jaeger: run `docker run -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one`
 *     then set OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *   - Grafana Tempo: free open-source
 *   - Console exporter (default here): no server needed, logs spans to stdout
 */
export async function initTracing(serviceName = 'merry'): Promise<void> {
  if (initialized) return;

  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { ConsoleSpanExporter, SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');

    const exporter = new ConsoleSpanExporter();
    const sdk = new NodeSDK({
      serviceName,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });

    sdk.start();
    initialized = true;
    logger.info({ serviceName }, 'OpenTelemetry tracing initialized (console exporter)');
  } catch (err) {
    logger.warn({ err: String(err) }, 'OpenTelemetry initialization failed — tracing disabled');
  }
}

/** Get the tracer for manual span creation. */
export function getTracer() {
  return trace.getTracer('merry');
}

/**
 * Wrap an async function in a named span.
 * Records exceptions and sets error status automatically.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  if (!initialized) return fn(trace.getTracer('noop').startSpan('noop'));

  return getTracer().startActiveSpan(name, async (span) => {
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
      }
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
