/**
 * M1c follow-up (2026-07-17, post-landing accuracy-validator finding — TWO rounds)
 *
 * evaluateSignals() has too many DB/gateway dependencies to build a full
 * behavioral harness cheaply — this is the established pattern for this exact
 * function in this codebase (see paper-signal-service-deepscan-findings.test.ts
 * and paper-signal-service-profit-milestone-shadow-wiring.test.ts): structural
 * assertions against the source text directly verify the invariants below.
 *
 * ROUND 1 (advisor + doer census) found 5 real gaps beyond the original
 * computeIndicators() reroute:
 *
 *   #7 (MOST SEVERE parity fix): the pending-entry FILL/consumption side had
 *      no isBucketClose gate, while the QUEUE side already had one. For a non-1m
 *      session this filled a queued entry on the very next RAW 1-minute bar
 *      instead of the next real N-minute bar close. Verified against the
 *      backtester.py oracle: vbt.Portfolio.from_signals is called with only
 *      `close` as price (no separate open), so the np.roll(+1)'d signal fills
 *      at the NEXT bar's CLOSE.
 *
 *   #3 (parity fix): fetchICTIndicators() (the ICT/SMT/order-flow bridge)
 *      still passed the raw barBuffer — the backtest computes the same
 *      indicators (shared src/engine/indicators/* functions) from its own
 *      N-minute frame.
 *
 *   #6 (parity fix): medianBarVolume (feeds openPosition's fill-probability
 *      model, matching the backtest's own N-minute bar_volume-based partial-
 *      fill degradation) was computed from the raw buffer.
 *
 *   #4 (internal-consistency fix, NOT backtest-parity — confirmed via grep that
 *      "volume_confirmation" has no counterpart anywhere in backtester.py):
 *      compared a raw 1-minute bar's volume against a rolling mean of
 *      1-minute volumes, mixing an aggregated indicator set with a raw-bar
 *      volume factor in the same entry decision.
 *
 * ROUND 2 (independent accuracy-validator re-grade) found the round-1
 * disposition of two "not a parity bug" findings was wrong or incomplete,
 * plus a subtler bug baked into the original M1c wave itself:
 *
 *   F-1 (CRITICAL, corrects round 1's wrong disposition): context-gate-service.ts's
 *      intraday_bars — round 1 claimed no backtest counterpart via a too-narrow
 *      grep. Actually: context_runner.py::run_evaluate() calls the SAME seven
 *      functions backtester.py::apply_eligibility_gate() calls, on backtester's
 *      own exec-timeframe df — this IS the backtest-mirrored 7-layer eligibility
 *      gate, and it's LIVE-ENFORCED (SKIP/REDUCE on sizing). Fixed: threaded
 *      mtfContext into evaluateContextGate(), aggregated intraday_bars +
 *      entryPrice for non-1m sessions.
 *
 *   F-2 (HIGH, corrects round 1's understated severity): updateStateOnly's
 *      round-1 disposition called this "one-bucket-stale, self-healing" — but
 *      backfillBars()'s bulk historical replay never feeds the aggregator at
 *      all, so a stale pre-disconnect bucket could get finalized as a
 *      truncated, wrong-OHLCV "completed" bucket the moment the first live bar
 *      arrived post-reconnect. Fixed: resetAggregatorForSymbol(symbol) at the
 *      top of backfillBars() discards the stale accumulator (accepted
 *      cold-start, not a corrupted one).
 *
 *   F-3 (round-1's own #7 fix had a residual bug): timeframe-bar-aggregator.ts's
 *      own documented contract says isBucketClose fires on the bar that STARTS
 *      the next bucket — so at that instant `bar` is NOT the bar that just
 *      closed. Every decision-recording site (signal price, signal bar
 *      timestamp, signal-time volume) that read `bar.close`/`bar.timestamp`/
 *      `bar.volume` directly was reading the WRONG bar's value — up to N-1
 *      minutes later than the bar the decision is actually about. Fixed via a
 *      single `closedBucketBar`/`closedFillBucketBar` local (the aggregated
 *      bucket's own last entry when mtfContext is present, `bar` itself when
 *      not) substituted at every decision-recording site — NOT at genuinely
 *      wall-clock sites (blackout windows, DLL, news, session classification),
 *      which correctly keep reading the actual current `bar` for real-time
 *      freshness.
 *
 * ROUND 2's own completeness claim for F-3 was ITSELF proven false by a THIRD
 * pass (2026-07-17, same-day): the regex that certified "no remaining raw-bar
 * site" only matched 8 hardcoded field names assigned directly from `bar.`
 * (`/(entryPrice|...|barVolume):\s*bar\./g`) — blind to `String(bar.close)`
 * wraps, generic `price:`/`timestamp:` fields, and object-literal
 * reconstructions (`weightedCtx.bar`, the Path-A confirming-indicators literal,
 * `adaptiveExitInput.bar`). Round 3 found + fixed 4 more real gaps:
 *
 *   F-4 (HIGH, dormant today — 0/120 strategies use Path A/C, but Path A is the
 *      DEFAULT activation path once any strategy graduates with
 *      confirming_indicators[] populated per §2b): the confluence Path A/C
 *      pipeline — getNearestLiquidity() calls, getSmtLiveSnapshot(), the
 *      PAPER_PARITY_DEGRADED diagnostic SSE, weightedCtx.bar, and
 *      evaluateConfirmingIndicators()'s object-literal argument — still built
 *      from raw `bar.*` fields despite the entry decision itself already being
 *      gated to closed-bucket cadence.
 *
 *   F-5 (MEDIUM, live for every signal): checkAntiSetupGate()'s time/hour/
 *      volume/day_of_week params were already fixed to closedBucketBar in round
 *      2, but the anti-setup gate's OWN audit trail (paperSignalLogs,
 *      shadowSignals, the anti-setup:blocked SSE) still recorded raw `bar.*` —
 *      an internal self-contradiction between the decision and its own record.
 *
 *   F-6 (MEDIUM, dormant — 0/120 strategies use exit_style="adaptive"):
 *      adaptiveExitInput.bar (feeds computeExitPlan()'s TP1/TP2/runner-trail
 *      level selection at position open) still used raw bar fields.
 *
 *   F-7 (MEDIUM, live for every signal): 7 audit-trail sites where the
 *      underlying DECISION was already fixed elsewhere but the audit/log
 *      record OF that decision still wrote raw bar values: context_gate_skip/
 *      reduce, governor_blocked/reduced, the fill_miss paperSignalLogs price,
 *      and a duplicate "Deferred entry filled" log's executionPrice.
 *
 * A FOURTH pass (same day, same session — a self-initiated re-enumeration
 * before declaring the wave done, cross-checked against a stronger reviewer)
 * found the F-4/F-5/F-6/F-7 fix set was STILL not exhaustive, closing 4 more:
 *
 *   - computePmSizeFactor()'s `barTsUtc` sizing input (paper-signal-service.ts)
 *     — a genuine SIZING decision (PM-taper multiplier keyed to 13:30/15:00 ET
 *     thresholds), not documentary, so it belongs in the closedBucketBar class
 *     alongside F-4, not the wall-clock class alongside the lunch/blackout gates.
 *   - The A+ gate's own reject/pass audit trail for all three confluence paths
 *     (Path A/B/C SSE broadcasts + paperSignalLogs rows) — same F-7-class
 *     self-contradiction: the underlying score/factor decision was fixed, its
 *     own audit record was not.
 *   - The SHADOW-stage signal-interception log + killzone derivation — the
 *     sibling lifecycleShadowSignals DB row in the same code block was already
 *     fixed to closedBucketBar; the log line and the killzone timestamp it
 *     feeds were not.
 *   - The Wave-29 RL A/B routing signal sent to routeOrder() — its own sibling
 *     audit row + SSE broadcast in the same block already used closedBucketBar.
 *
 * This file replaces the round-2 "does any `X: bar.*` pattern still exist"
 * regex (proven blind above) with POSITIVE invariant assertions against each
 * named decision construct, plus explicit pins on the constructs that
 * correctly stay on raw `bar` (wall-clock gates, documentary skip-audits) —
 * a universal negative can't be proven honestly; naming what must hold, and
 * what must NOT be "corrected", can.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
).replace(/\r\n/g, "\n");
const CONTEXT_GATE_SRC = readFileSync(
  resolve(__dirname, "../services/context-gate-service.ts"),
  "utf-8",
).replace(/\r\n/g, "\n");
const STREAM_SRC = readFileSync(
  resolve(__dirname, "../services/paper-trading-stream.ts"),
  "utf-8",
).replace(/\r\n/g, "\n");

function sliceBetween(src: string, startMarker: string, endMarker: string): string {
  const startIdx = src.indexOf(startMarker);
  expect(startIdx).toBeGreaterThan(-1);
  const endIdx = src.indexOf(endMarker, startIdx);
  expect(endIdx).toBeGreaterThan(startIdx);
  return src.slice(startIdx, endIdx);
}

describe("M1c follow-up #7 (most severe) — pending-entry fill consumption gated to isBucketClose", () => {
  it("the pendingEntry consumption condition requires (!mtfContext || mtfContext.isBucketClose)", () => {
    const block = sliceBetween(
      SRC,
      "const pendingKey = `${sessionId}:${symbol}`;",
      "pendingEntryQueue.delete(pendingKey); // consume the pending entry",
    );
    expect(block).toMatch(
      /if\s*\(\s*pendingEntry\s*&&\s*!openPos\s*&&\s*!isShadow\s*&&\s*\(\s*!mtfContext\s*\|\|\s*mtfContext\.isBucketClose\s*\)\s*\)/,
    );
  });

  it("the delete/consume + fill-execution logic lives INSIDE that gated block (a queued entry survives intervening raw bars, not gets dropped)", () => {
    const idxIf = SRC.indexOf(
      "if (pendingEntry && !openPos && !isShadow && (!mtfContext || mtfContext.isBucketClose)) {",
    );
    expect(idxIf).toBeGreaterThan(-1);
    const idxDelete = SRC.indexOf("pendingEntryQueue.delete(pendingKey);", idxIf);
    expect(idxDelete).toBeGreaterThan(idxIf);
    const between = SRC.slice(idxIf + "if (pendingEntry && !openPos && !isShadow && (!mtfContext || mtfContext.isBucketClose)) {".length, idxDelete);
    const codeOnly = between.split("\n").map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("//"));
    expect(codeOnly.length).toBe(0);
  });

  it("F-3: the fill defines closedFillBucketBar and uses it for signalPrice/executionPrice/barVolume (not raw bar)", () => {
    const block = sliceBetween(
      SRC,
      "if (pendingEntry && !openPos && !isShadow && (!mtfContext || mtfContext.isBucketClose)) {",
      "const deferredResult = await openPosition(sessionId, {",
    );
    expect(block).toContain(
      "const closedFillBucketBar: Bar = mtfContext\n      ? mtfContext.aggregatedBuffer[mtfContext.aggregatedBuffer.length - 1]\n      : bar;",
    );
    expect(block).toContain("executionPrice: closedFillBucketBar.close,");
  });

  it("F-3: signalPrice and barVolume passed to openPosition() use closedFillBucketBar, not raw bar", () => {
    const block = sliceBetween(
      SRC,
      "const deferredResult = await openPosition(sessionId, {",
      "medianBarVolume: pendingEntry.medianBarVolume,",
    );
    expect(block).toContain("signalPrice: closedFillBucketBar.close,");
    expect(block).toContain("barVolume: closedFillBucketBar.volume,");
    // barTimestamp deliberately STAYS on the raw bar (session-classification /
    // wall-clock use, not a price/decision value) — must NOT be substituted.
    expect(block).toContain("barTimestamp: new Date(bar.timestamp),");
  });
});

describe("M1c follow-up #3 — ICT/SMT indicator bridge sources from the aggregated buffer for non-1m sessions", () => {
  it("fetchICTIndicators() is called with mtfContext.aggregatedBuffer when mtfContext is present, raw barBuffer otherwise", () => {
    const block = sliceBetween(
      SRC,
      "const unknownInds = findUnknownIndicators(config);",
      "Object.assign(indicators, ictBridge.values);",
    );
    expect(block).toMatch(
      /fetchICTIndicators\(\s*\n\s*sessionId,\s*symbol,\s*bar\.timestamp,\s*\n\s*mtfContext\s*\?\s*mtfContext\.aggregatedBuffer\s*:\s*barBuffer,/,
    );
  });
});

describe("M1c follow-up #6 — medianBarVolume (entry fill-probability sizing) sources from the aggregated buffer", () => {
  it("the volumeSourceBuffer feeding medianBarVolume is mtfContext-aware", () => {
    const block = sliceBetween(
      SRC,
      'action = "open"; // log as "open" pending',
      "const currentAtrForEntry = indicators",
    );
    expect(block).toContain("const volumeSourceBuffer = mtfContext ? mtfContext.aggregatedBuffer : barBuffer;");
    expect(block).toContain("volumeSourceBuffer\n          .map((bufferBar) => bufferBar.volume)");
  });
});

describe("M1c follow-up #4 — volume_confirmation factor (internal-consistency fix, no backtest counterpart) sources from the aggregated buffer", () => {
  it('the "volume_confirmation" branch is mtfContext-aware for both the series and the "current bar" volume it compares', () => {
    const block = sliceBetween(
      SRC,
      'factor === "volume_confirmation"',
      'factor === "macro_alignment"',
    );
    expect(block).toContain("const volumeSourceBuffer = mtfContext ? mtfContext.aggregatedBuffer : barBuffer;");
    expect(block).toMatch(
      /const currentBarVolume = mtfContext\s*\n\s*\?\s*volumeSourceBuffer\[volumeSourceBuffer\.length - 1\]\?\.volume\s*\n\s*:\s*bar\.volume;/,
    );
    expect(block).toContain("satisfied = currentBarVolume !== undefined && currentBarVolume > rollingMean * 1.2;");
  });
});

describe("M1c follow-up F-1 (CRITICAL, corrects round-1's wrong 'no counterpart' disposition) — context gate sources intraday_bars + entryPrice from the aggregated buffer", () => {
  it("evaluateContextGate() accepts an mtfContext param and sources intraday_bars from it", () => {
    const block = sliceBetween(
      CONTEXT_GATE_SRC,
      "export async function evaluateContextGate(",
      "// Fire context engine and tensor signal in parallel",
    );
    expect(block).toContain("mtfContext?: { isBucketClose: boolean; aggregatedBuffer: Bar[] },");
    expect(block).toContain("intraday_bars: (mtfContext ? mtfContext.aggregatedBuffer : barBuffer).map((b) => ({");
  });

  it("the paper-signal-service.ts call site passes mtfContext and the closed-bucket close as entryPrice", () => {
    const block = sliceBetween(
      SRC,
      "const ctxGate = await evaluateContextGate(",
      "sessionConfig.name, barBuffer, indicators, mtfContext,",
    );
    expect(block).toContain(
      "mtfContext ? mtfContext.aggregatedBuffer[mtfContext.aggregatedBuffer.length - 1].close : bar.close,",
    );
  });
});

describe("M1c follow-up F-2 (corrects round-1's understated severity) — backfillBars resets the aggregator to prevent a corrupted bucket on reconnect", () => {
  it("backfillBars() calls resetAggregatorForSymbol(symbol) before the historical replay begins", () => {
    const block = sliceBetween(
      STREAM_SRC,
      "async function backfillBars(symbol: string, lastTimestamp: string) {",
      "try {\n    const fetcher = getMassiveFetcher();",
    );
    expect(block).toContain("resetAggregatorForSymbol(symbol);");
  });
});

describe("M1c follow-up F-3 — closedBucketBar/closedFillBucketBar are declared once each, at the top of their branch", () => {
  it("closedBucketBar is declared once, right after the entry-signal isBucketClose gate", () => {
    const block = sliceBetween(
      SRC,
      "if (mtfContext && !mtfContext.isBucketClose) {\n      previousIndicators.set(prevKey, indicators);\n      span.end();\n      return;\n    }",
      "// ─── FIX 4 (Track M): Kill-switch halt check",
    );
    expect(block).toContain(
      "const closedBucketBar: Bar = mtfContext\n      ? mtfContext.aggregatedBuffer[mtfContext.aggregatedBuffer.length - 1]\n      : bar;",
    );
  });

  it("closedFillBucketBar is declared once, at the top of the pending-entry fill-consumption block", () => {
    const block = sliceBetween(
      SRC,
      "pendingEntryQueue.delete(pendingKey); // consume the pending entry",
      "// ─── H3 (2026-06-23): Re-evaluate all entry gates at fill time (bar N+1) ──",
    );
    expect(block).toContain(
      "const closedFillBucketBar: Bar = mtfContext\n      ? mtfContext.aggregatedBuffer[mtfContext.aggregatedBuffer.length - 1]\n      : bar;",
    );
  });
});

describe("M1c follow-up F-4 (round 3) — confluence Path A/C pipeline sources every decision field from closedBucketBar, not raw bar", () => {
  it("both getNearestLiquidity() calls use closedBucketBar.close", () => {
    const block = sliceBetween(SRC, "const [liquidityNearestAbove, liquidityNearestBelow, smtSnapshot]", "const weightedCtx: WeightedSignalContext = {");
    expect(block).toContain('getNearestLiquidity(symbol, closedBucketBar.close, "above")');
    expect(block).toContain('getNearestLiquidity(symbol, closedBucketBar.close, "below")');
  });

  it("getSmtLiveSnapshot() uses new Date(closedBucketBar.timestamp)", () => {
    const block = sliceBetween(SRC, "const [liquidityNearestAbove, liquidityNearestBelow, smtSnapshot]", "const weightedCtx: WeightedSignalContext = {");
    expect(block).toContain("getSmtLiveSnapshot(\n                new Date(closedBucketBar.timestamp),");
  });

  it("the PAPER_PARITY_DEGRADED diagnostic SSE broadcast uses closedBucketBar for price + timestamp", () => {
    const block = sliceBetween(SRC, 'broadcastSSE("PAPER_PARITY_DEGRADED"', "const weightedCtx: WeightedSignalContext = {");
    expect(block).toContain("price: closedBucketBar.close,");
    expect(block).toContain("timestamp: closedBucketBar.timestamp,");
  });

  it("weightedCtx.bar is fully sourced from closedBucketBar (open/high/low/close/volume/timestamp)", () => {
    const block = sliceBetween(SRC, "const weightedCtx: WeightedSignalContext = {", "indicators: indicators as Record<string, number | undefined>,");
    expect(block).toContain("open: closedBucketBar.open,");
    expect(block).toContain("high: closedBucketBar.high,");
    expect(block).toContain("low: closedBucketBar.low,");
    expect(block).toContain("close: closedBucketBar.close,");
    expect(block).toContain("volume: closedBucketBar.volume ?? 0,");
    expect(block).toContain('typeof closedBucketBar.timestamp === "number" ? closedBucketBar.timestamp : undefined,');
    // Regression guard: no raw `bar.` reference should have crept back into
    // this specific object literal (unlike the universal-negative regex this
    // replaces, this is scoped to ONE named construct, so it can't be blind
    // to unrelated legitimate wall-clock sites elsewhere in the file).
    expect(block).not.toMatch(/:\s*bar\.(open|high|low|close|volume|timestamp)\b/);
  });

  it("evaluateConfirmingIndicators() (Path A) is called with an object literal fully sourced from closedBucketBar", () => {
    const block = sliceBetween(SRC, "const rawResults = evaluateConfirmingIndicators(", "for (const r of rawResults) {");
    expect(block).toContain(
      "{ open: closedBucketBar.open, high: closedBucketBar.high, low: closedBucketBar.low, close: closedBucketBar.close, volume: closedBucketBar.volume ?? 0 }",
    );
  });
});

describe("M1c follow-up F-5 (round 3) — anti-setup gate's OWN audit trail matches the closedBucketBar-gated decision it records", () => {
  it("checkAntiSetupGate() is called with closedBucketBar for time/hour/volume/day_of_week", () => {
    const block = sliceBetween(SRC, "antiSetupResult = await checkAntiSetupGate(", "if (antiSetupResult.blocked) {");
    expect(block).toContain("time: closedBucketBar.timestamp,");
    expect(block).toContain("hour: new Date(closedBucketBar.timestamp).getHours(),");
    expect(block).toContain("volume: closedBucketBar.volume,");
    expect(block).toContain("day_of_week: toPythonWeekday(closedBucketBar.timestamp),");
  });

  it("the anti-setup paperSignalLogs row, shadowSignals row, and SSE broadcast all use closedBucketBar (not raw bar)", () => {
    const block = sliceBetween(SRC, "if (antiSetupResult.blocked) {", "} catch (antiSetupErr) {");
    expect(block).toContain('price: String(closedBucketBar.close),');
    expect(block).toContain("signalTime: new Date(closedBucketBar.timestamp),");
    expect(block).toContain("expectedEntry: String(closedBucketBar.close),");
    expect(block).toContain("actualMarketPrice: String(closedBucketBar.close),");
    expect(block).toContain("price: closedBucketBar.close,");
    expect(block).toContain("timestamp: closedBucketBar.timestamp,");
    expect(block).not.toMatch(/:\s*(String\()?bar\.(close|timestamp)\b/);
  });
});

describe("M1c follow-up F-6 (round 3) — adaptiveExitInput.bar sources from closedFillBucketBar", () => {
  it("the adaptiveExitInput.bar object uses closedFillBucketBar for close/high/low/volume", () => {
    const block = sliceBetween(SRC, "adaptiveExitInput:", "marketState: {");
    expect(block).toContain(
      "bar: { close: closedFillBucketBar.close, high: closedFillBucketBar.high, low: closedFillBucketBar.low, volume: closedFillBucketBar.volume },",
    );
  });
});

describe("M1c follow-up F-7 (round 3) — audit-of-a-decision sites match the decision they record", () => {
  it("context_gate_skip and context_gate_reduce paperSignalLogs rows use closedBucketBar.close", () => {
    const block = sliceBetween(SRC, 'const skipReason = `context_gate_skip:', "// TAKE → proceed with full size");
    expect(block).toContain("price: String(closedBucketBar.close), // M1c follow-up (F-7): audit trail must match the decision's own bar");
    const occurrences = block.match(/price: String\(closedBucketBar\.close\)/g);
    expect(occurrences?.length).toBe(2);
  });

  it("governor_blocked and governor_reduced paperSignalLogs rows use closedBucketBar.close", () => {
    const block = sliceBetween(SRC, "const govResult = checkGovernor(", "// ─── B8b: PILOT canary");
    const occurrences = block.match(/price: String\(closedBucketBar\.close\)/g);
    expect(occurrences?.length).toBe(2);
  });

  it("the fill_miss paperSignalLogs row uses closedFillBucketBar.close", () => {
    const block = sliceBetween(SRC, "fillMiss = true;", "Failed to log deferred fill miss to DB");
    expect(block).toContain("price: String(closedFillBucketBar.close), // M1c follow-up (F-7): audit trail must match the decision's own bar");
  });

  it('the "Deferred entry filled" log uses closedFillBucketBar.close, matching openPosition\'s own signalPrice', () => {
    const block = sliceBetween(SRC, '"FIX 1: Deferred entry filled', "// ─── Server-Mediated Execution", );
    // sliceBetween needs start marker BEFORE end marker in file order — the log
    // call precedes its own string literal argument, so search the surrounding
    // block instead.
    const idx = SRC.indexOf('"FIX 1: Deferred entry filled — position opened at bar N+1 close"');
    expect(idx).toBeGreaterThan(-1);
    const surrounding = SRC.slice(idx - 400, idx);
    expect(surrounding).toContain("executionPrice: closedFillBucketBar.close,");
  });
});

describe("M1c follow-up (4th pass, self-initiated re-enumeration) — remaining gaps found after F-4/F-5/F-6/F-7", () => {
  it("computePmSizeFactor()'s sizing input uses closedBucketBar.timestamp, not raw bar (PM-taper is a sizing decision, not documentary)", () => {
    const block = sliceBetween(SRC, "pmSizeFactor:", "provenTrades:");
    expect(block).toContain("computePmSizeFactor({ barTsUtc: new Date(closedBucketBar.timestamp) }).factor *");
  });

  it("A+ gate Path C (weighted) reject/pass audit trail uses closedBucketBar", () => {
    const block = sliceBetween(SRC, "if (!weightedResult.passed) {", "} else {\n            // ── Path B: canonical 5-factor list");
    const priceOccurrences = block.match(/price: (String\()?closedBucketBar\.close\)?/g);
    expect(priceOccurrences?.length).toBeGreaterThanOrEqual(3); // SSE + rejected row + passed row
    expect(block).not.toMatch(/price: (String\()?bar\.close\)?/);
  });

  it("A+ gate Path A (per-strategy confirming_indicators) reject/pass audit trail uses closedBucketBar", () => {
    const block = sliceBetween(SRC, "if (!passed) {\n              stage2Blocked = true;\n              logger.info(\n                { sessionId, symbol, satisfiedCount, minRequired, factorResults, factorSource, strategyId: sessionConfig.strategyId },\n                \"Wave 23H.D Stage 2: A+ gate REJECTED", "} else {\n            // ── Path B: canonical 5-factor list");
    expect(block).toContain("price: closedBucketBar.close,");
    expect(block).toContain("timestamp: closedBucketBar.timestamp,");
    const priceOccurrences = block.match(/price: (String\()?closedBucketBar\.close\)?/g);
    expect(priceOccurrences?.length).toBeGreaterThanOrEqual(3);
  });

  it("A+ gate Path B (canonical-5) per-factor + reject/pass audit trail uses closedBucketBar", () => {
    const block = sliceBetween(SRC, "// Per-factor audit row — canonical_5 source tag.", "entryCtxConfluenceFactorsActive = factorResults.filter((r) => r.satisfied).map((r) => r.factor);");
    const priceOccurrences = block.match(/price: (String\()?closedBucketBar\.close\)?/g);
    expect(priceOccurrences?.length).toBeGreaterThanOrEqual(4); // per-factor + SSE + rejected + passed
    expect(block).not.toMatch(/price: (String\()?bar\.close\)?/);
  });

  it("the SHADOW-stage interception log and killzone derivation use closedBucketBar (matching the lifecycleShadowSignals row in the same block)", () => {
    const block = sliceBetween(SRC, "// Normal SHADOW stage: intercept signal, log, skip TradersPost.", "// INSERT lifecycle_shadow_signals row.");
    expect(block).toContain("price: closedBucketBar.close },");
    expect(block).toContain("const barDate = closedBucketBar.timestamp ? new Date(closedBucketBar.timestamp) : new Date();");
  });

  it("the RL A/B routing signal sent to routeOrder() uses closedBucketBar.timestamp (matching the sibling audit row + SSE in the same block)", () => {
    const block = sliceBetween(SRC, "const { routeOrder } = await import(\"./broker-router.js\");", "const routeResult = await routeOrder(");
    expect(block).toContain('typeof closedBucketBar.timestamp === "number"');
    expect(block).toContain("new Date(closedBucketBar.timestamp).toISOString()");
    expect(block).not.toMatch(/bar\.timestamp/);
  });
});

describe("M1c follow-up (5th pass — 4th independent grade found 4 more) — loggedBar + remaining audit-trail siblings", () => {
  it("loggedBar is declared once at function scope, defaulting to raw bar", () => {
    const block = sliceBetween(SRC, 'let action: SignalLogEntry["action"] = "none";', "// Convenience: current ATR for passing to closePosition");
    expect(block).toContain("let loggedBar: Bar = bar;");
  });

  it("F-8: the entry-signal branch's action = \"open\" site reassigns loggedBar to closedBucketBar", () => {
    const entrySiteBlock = sliceBetween(SRC, 'action = "open"; // log as "open" pending', "// M1c follow-up (2026-07-17): median bar volume");
    expect(entrySiteBlock).toContain("loggedBar = closedBucketBar;");
  });

  it("5th-grade correction: the fill-consumption branch's action = \"open\" site does NOT reassign loggedBar (it would be dead code — see next test)", () => {
    const fillSiteBlock = sliceBetween(SRC, "if (deferredResult.position) {", "positionBarsHeld.set(deferredResult.position.id, 0);");
    expect(fillSiteBlock).toContain('action = "open";');
    expect(fillSiteBlock).not.toMatch(/loggedBar\s*=/);
  });

  it("5th-grade regression guard: the pendingEntry consumption block still unconditionally returns before the function-final logSignal() call — if this ever changes, loggedBar must be reassigned to closedFillBucketBar at the fill-success site above", () => {
    const block = sliceBetween(
      SRC,
      "// After a deferred fill (success or miss), skip the rest of this bar's signal",
      "if (openPos && !isShadow) {",
    );
    expect(block).toContain("previousIndicators.set(prevKey, indicators);\n    span.end();\n    return;\n  }");
    // The function-final logSignal() call must occur strictly AFTER this
    // block in the source — proves the two can never both execute for the
    // same bar (the return always fires first).
    const blockEndIdx = SRC.indexOf("if (openPos && !isShadow) {");
    const logSignalIdx = SRC.lastIndexOf("await logSignal({");
    expect(logSignalIdx).toBeGreaterThan(blockEndIdx);
  });

  it("F-8: the function-final logSignal() call reads loggedBar, not raw bar, for timestamp/barClose", () => {
    const idx = SRC.lastIndexOf("await logSignal({");
    expect(idx).toBeGreaterThan(-1);
    const block = SRC.slice(idx, idx + 400);
    expect(block).toContain("timestamp: loggedBar.timestamp,");
    expect(block).toContain("barClose: loggedBar.close,");
    expect(block).not.toMatch(/:\s*bar\.(timestamp|close)\b/);
  });

  it("the 15:55 ET time-stop logSignal() call correctly stays on raw bar (a genuine tick-level exit event, not an entry decision)", () => {
    const block = sliceBetween(SRC, '"Paper position closed — 15:55 ET hard time-stop (Style C canonical)"', '"Failed to log time-stop signal entry"');
    expect(block).toContain("timestamp: bar.timestamp,");
    expect(block).toContain("barClose: bar.close,");
  });

  it("F-9: a_plus_bypassed_legacy uses closedBucketBar.close, matching every sibling a_plus_* audit action", () => {
    const block = sliceBetween(SRC, 'signalType: "a_plus_bypassed_legacy",', '"Failed to persist A+ bypass log"');
    expect(block).toContain("price: String(closedBucketBar.close),");
  });

  it("F-10: Path C's own per-factor audit loop (weightedResult.factorContributions) uses closedBucketBar.close", () => {
    const block = sliceBetween(SRC, "// Per-factor audit rows (fire-and-forget).", "Failed to persist Path C factor audit log");
    expect(block).toContain("price: String(closedBucketBar.close),");
  });

  it("F-11: the H3 fill-execution log's executionBarTimestamp uses closedFillBucketBar.timestamp, matching executionPrice beside it", () => {
    const block = sliceBetween(SRC, "contracts: pendingEntry.contracts,\n        executionPrice: closedFillBucketBar.close,", '"FIX 1: Executing deferred entry from previous bar (next-bar fill parity)"');
    expect(block).toContain("executionBarTimestamp: closedFillBucketBar.timestamp,");
  });
});

describe("M1c follow-up — pins on sites that correctly stay on raw `bar` (over-correction guard)", () => {
  it("the price-lock real-time limit check stays on raw bar.close (a live price-vs-limit safety check, not a decision magnitude)", () => {
    const block = sliceBetween(SRC, "const lock = checkPriceLockLimit(symbolToUnderlying(symbol), bar.close, refSettlement);", "if (lock.blocked) {");
    expect(block).toBeDefined(); // presence check — the call itself is the pin
  });

  it("the lunch blackout gate's barTsUtc stays on raw bar.timestamp (a wall-clock window check)", () => {
    const block = sliceBetween(SRC, "const lunchResult = evaluateLunchBlackoutGate({", "perStrategyDisabled,\n      });");
    expect(block).toContain("barTsUtc: new Date(bar.timestamp),");
  });

  it("the symbol-not-enabled-for-account whitelist block stays on raw bar.close (a firm/account config check, not a price decision)", () => {
    const block = sliceBetween(SRC, 'signalType: "symbol_not_enabled_for_account",', "_blocked_symbol: symbol,");
    expect(block).toContain("price: String(bar.close),");
  });

  it("openPosition()'s deferred-fill barTimestamp param stays on raw bar.timestamp (session-classification, not a price/decision value)", () => {
    const block = sliceBetween(SRC, "const deferredResult = await openPosition(sessionId, {", "rsi: pendingEntry.rsi,");
    expect(block).toContain("barTimestamp: new Date(bar.timestamp), // bar N+1 timestamp for session classification");
  });
});
