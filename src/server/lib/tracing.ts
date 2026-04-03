/**
 * OpenTelemetry tracing setup for Trading Forge.
 *
 * Behaviour by environment:
 *   - OTEL_EXPORTER_OTLP_ENDPOINT set  → OTLP HTTP export (BatchSpanProcessor in prod, Simple in dev)
 *   - Dev, no endpoint                 → ConsoleSpanExporter (SimpleSpanProcessor)
 *   - Prod, no endpoint                → no-op (spans are created but immediately discarded)
 *
 * A WARNING is emitted at startup whenever OTel is not configured so the
 * absence of traces is never silent.
 *
 * Consumers import `tracer` (OTel Tracer or NoOpTracer) and `OTEL_AVAILABLE`
 * (boolean — true only when real spans are being exported).
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

// ─── Resolve package version at module load time ─────────────────────────────

function resolveServiceVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, "../../../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ─── No-op fallback types (kept for type compatibility) ───────────────────────

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string): Span;
}

class NoOpSpan implements Span {
  setAttribute(_key: string, _value: string | number | boolean): void {}
  end(): void {}
}

class NoOpTracer implements Tracer {
  startSpan(_name: string): Span {
    return new NoOpSpan();
  }
}

// ─── OTel initialisation ──────────────────────────────────────────────────────

let tracer: Tracer;
let OTEL_AVAILABLE = false;

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const isDev = process.env.NODE_ENV !== "production";

try {
  const { trace } = await import("@opentelemetry/api");
  const { NodeTracerProvider } = await import("@opentelemetry/sdk-trace-node");
  const { SimpleSpanProcessor, BatchSpanProcessor, ConsoleSpanExporter } = await import("@opentelemetry/sdk-trace-base");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { Resource } = await import("@opentelemetry/resources");
  const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = await import("@opentelemetry/semantic-conventions");

  const resource = new Resource({
    [SEMRESATTRS_SERVICE_NAME]: "trading-forge",
    [SEMRESATTRS_SERVICE_VERSION]: resolveServiceVersion(),
  });

  const provider = new NodeTracerProvider({ resource });

  if (otlpEndpoint) {
    // Real export — OTLP HTTP to the configured collector
    const exporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });
    const processor = isDev
      ? new SimpleSpanProcessor(exporter)   // immediate flush in dev for easier debugging
      : new BatchSpanProcessor(exporter);   // efficient batching in prod
    provider.addSpanProcessor(processor);
    OTEL_AVAILABLE = true;
  } else if (isDev) {
    // Dev without a collector: emit to console so spans are visible locally
    provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    OTEL_AVAILABLE = true;
  }
  // Prod without endpoint: provider registered with no processor → spans are no-ops at the SDK level

  provider.register();
  tracer = trace.getTracer("trading-forge");
} catch (err) {
  // OTel packages failed to load — fall back to no-op rather than crashing the server
  console.warn("[tracing] Failed to initialize OpenTelemetry — falling back to no-op", err);
  tracer = new NoOpTracer();
}

export { tracer, OTEL_AVAILABLE };
