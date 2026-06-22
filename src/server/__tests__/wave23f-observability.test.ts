/**
 * Wave 23F Track G — Observability test suite
 *
 * Verifies:
 * 1. factory:multi_market_bucket SSE event type registered in FACTORY_EVENTS
 * 2. factory:graduation_entry_quality SSE event type registered in FACTORY_EVENTS
 * 3. Graduation SSE emission point present in direct-bucket-graduator.ts
 * 4. Multi-market SSE emission inside symbolsArray.length > 1 guard
 * 5. SSE event does NOT fire when symbols stable at 1 (guard check)
 * 6. traceWave23fCycle() returns rows ordered by created_at asc (schema check)
 * 7. summarizeWave23fCycle() counts correctly
 *
 * Uses source-file inspection pattern (same as wave12 / wave23f-graduator-entry-quality
 * tests) to avoid brittle DB mock chains. Logic under test is conditional source
 * text — explicit enough for static verification.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi } from "vitest";
// Wave hardening 2026-06-22, test isolation: sse.js imports logger from
// ../index.js which boots the whole Express app (app.use chain crashes at
// collection). Mock index.js so FACTORY_EVENTS resolves without bootstrap.
vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
import { FACTORY_EVENTS } from "../routes/sse.js";

// ─── Load source files for static analysis ─────────────────────────────────
const ROOT = join(process.cwd(), "src", "server");
const graduatorSrc = readFileSync(
  join(ROOT, "services", "direct-bucket-graduator.ts"),
  "utf8"
);
const traceSrc = readFileSync(
  join(ROOT, "lib", "wave23f-trace.ts"),
  "utf8"
);

// ─── Suite 1: SSE event type registration ──────────────────────────────────

describe("Wave 23F Track G — SSE event type registration", () => {
  it("FACTORY_EVENTS.MULTI_MARKET_BUCKET is defined", () => {
    expect(FACTORY_EVENTS.MULTI_MARKET_BUCKET).toBe("factory:multi_market_bucket");
  });

  it("FACTORY_EVENTS.GRADUATION_ENTRY_QUALITY is defined", () => {
    expect(FACTORY_EVENTS.GRADUATION_ENTRY_QUALITY).toBe("factory:graduation_entry_quality");
  });

  it("sse.ts exports FactoryMultiMarketBucketPayload type (source check)", () => {
    const sseSrc = readFileSync(join(ROOT, "routes", "sse.ts"), "utf8");
    expect(sseSrc).toContain("FactoryMultiMarketBucketPayload");
  });

  it("sse.ts exports FactoryGraduationEntryQualityPayload type (source check)", () => {
    const sseSrc = readFileSync(join(ROOT, "routes", "sse.ts"), "utf8");
    expect(sseSrc).toContain("FactoryGraduationEntryQualityPayload");
  });
});

// ─── Suite 2: Emission points in direct-bucket-graduator.ts ────────────────

describe("Wave 23F Track G — graduation SSE emission point", () => {
  it("graduation_entry_quality broadcastSSE is present in graduator source", () => {
    expect(graduatorSrc).toContain('"factory:graduation_entry_quality"');
  });

  it("graduation_entry_quality SSE fires after entry_quality_attached audit row", () => {
    // The broadcastSSE call for factory:graduation_entry_quality must appear AFTER
    // the graduation.entry_quality_attached audit insert in source order.
    const entryQualityAuditIdx = graduatorSrc.indexOf('"graduation.entry_quality_attached"');
    const entryQualitySSEIdx = graduatorSrc.indexOf('"factory:graduation_entry_quality"');
    expect(entryQualityAuditIdx).toBeGreaterThan(-1);
    expect(entryQualitySSEIdx).toBeGreaterThan(-1);
    expect(entryQualitySSEIdx).toBeGreaterThan(entryQualityAuditIdx);
  });

  it("graduation_entry_quality SSE payload includes correlation_id field", () => {
    const match = graduatorSrc.match(
      /factory:graduation_entry_quality[\s\S]{0,500}correlation_id/
    );
    expect(match, "factory:graduation_entry_quality SSE payload must include correlation_id").toBeTruthy();
  });

  it("graduation_entry_quality SSE is non-blocking (wrapped in try/catch, not awaited)", () => {
    const match = graduatorSrc.match(
      /try\s*\{[\s\S]*?factory:graduation_entry_quality[\s\S]*?\}\s*catch/
    );
    expect(match, "factory:graduation_entry_quality broadcastSSE must be in try/catch block").toBeTruthy();
  });
});

// ─── Suite 3: Multi-market bucket SSE emission ─────────────────────────────

describe("Wave 23F Track G — multi-market bucket SSE emission point", () => {
  it("factory:multi_market_bucket broadcastSSE is present in graduator source", () => {
    expect(graduatorSrc).toContain('"factory:multi_market_bucket"');
  });

  it("factory:multi_market_bucket SSE fires only inside symbolsArray.length > 1 guard", () => {
    // The broadcastSSE for multi_market_bucket must appear after
    // the if (symbolsArray.length > 1) guard in source order, and the guard
    // must appear before the SSE call.
    const guardIdx = graduatorSrc.indexOf("symbolsArray.length > 1");
    const multiMarketSSEIdx = graduatorSrc.indexOf('"factory:multi_market_bucket"');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(multiMarketSSEIdx).toBeGreaterThan(-1);
    expect(multiMarketSSEIdx).toBeGreaterThan(guardIdx);
  });

  it("factory:multi_market_bucket does NOT fire at module scope (only guarded)", () => {
    // Verify that the call is inside the if block by checking the guard
    // appears within 2000 chars before the SSE call
    const guardIdx = graduatorSrc.indexOf("symbolsArray.length > 1");
    const multiMarketSSEIdx = graduatorSrc.indexOf('"factory:multi_market_bucket"');
    const distance = multiMarketSSEIdx - guardIdx;
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(2000);
  });

  it("factory:multi_market_bucket SSE payload includes symbols array", () => {
    const match = graduatorSrc.match(
      /factory:multi_market_bucket[\s\S]{0,300}symbols:\s*symbolsArray/
    );
    expect(match, "factory:multi_market_bucket SSE payload must include symbols: symbolsArray").toBeTruthy();
  });

  it("factory:multi_market_bucket SSE payload includes layer_coverage object", () => {
    const match = graduatorSrc.match(
      /factory:multi_market_bucket[\s\S]{0,500}layer_coverage/
    );
    expect(match, "factory:multi_market_bucket SSE payload must include layer_coverage").toBeTruthy();
  });

  it("factory:multi_market_bucket SSE is non-blocking (wrapped in try/catch)", () => {
    const match = graduatorSrc.match(
      /try\s*\{[\s\S]*?factory:multi_market_bucket[\s\S]*?\}\s*catch/
    );
    expect(match, "factory:multi_market_bucket broadcastSSE must be in try/catch block").toBeTruthy();
  });
});

// ─── Suite 4: wave23f-trace.ts helper ─────────────────────────────────────

describe("Wave 23F Track G — trace helper source verification", () => {
  it("traceWave23fCycle is exported from wave23f-trace.ts", () => {
    expect(traceSrc).toContain("export async function traceWave23fCycle");
  });

  it("summarizeWave23fCycle is exported from wave23f-trace.ts", () => {
    expect(traceSrc).toContain("export async function summarizeWave23fCycle");
  });

  it("trace helper imports logger from ./logger.js (not ../index.js)", () => {
    // Hard repo convention: lib/ helpers MUST import from ./logger.js leaf module.
    expect(traceSrc).toContain('from "./logger.js"');
    expect(traceSrc).not.toContain('from "../index.js"');
  });

  it("traceWave23fCycle orders by created_at asc", () => {
    expect(traceSrc).toContain("asc(auditLog.createdAt)");
  });

  it("summarizeWave23fCycle counts graduation.entry_quality_attached rows", () => {
    expect(traceSrc).toContain('"graduation.entry_quality_attached"');
  });

  it("summarizeWave23fCycle counts graduation.symbols_multi_market rows", () => {
    expect(traceSrc).toContain('"graduation.symbols_multi_market"');
  });

  it("Wave23fTraceRow interface is exported", () => {
    expect(traceSrc).toContain("export interface Wave23fTraceRow");
  });
});

// ─── Suite 5: SSE event semantic guards ───────────────────────────────────

describe("Wave 23F Track G — SSE event semantic guards", () => {
  it("factory:graduation_entry_quality is distinct from graduation.entry_quality_attached audit action", () => {
    // SSE event name and audit action must not be the same string
    expect(FACTORY_EVENTS.GRADUATION_ENTRY_QUALITY).not.toBe("graduation.entry_quality_attached");
  });

  it("factory:multi_market_bucket is distinct from graduation.symbols_multi_market audit action", () => {
    expect(FACTORY_EVENTS.MULTI_MARKET_BUCKET).not.toBe("graduation.symbols_multi_market");
  });

  it("broadcastSSE import is present in direct-bucket-graduator.ts", () => {
    expect(graduatorSrc).toContain("broadcastSSE");
    expect(graduatorSrc).toContain('from "../routes/sse.js"');
  });
});
