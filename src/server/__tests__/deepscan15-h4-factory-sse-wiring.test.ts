// Deep-scan #15 FIX-3 (H4) — regression guard for the FACTORY_EVENTS that were
// declared in sse.ts's FACTORY_EVENTS catalog (with full payload docs) but had
// ZERO broadcastSSE() call sites anywhere in the repo: SCOUT_IDEA_EXTRACTED,
// STRATEGY_CREATED, FRAMEWORK_OVERLAY_APPLIED. This pass wired all three at
// their real producer emit points instead of leaving them documented-but-dead.
// Source-grep style (read-only) — matches the pattern already used by
// deepscan6-lifecycle-gate-failmode.test.ts and this pass's own
// deepscan15-slippage-survival-infra-error-guard.test.ts: heavy DB/HTTP
// mocking of direct-bucket-graduator.ts / autonomous-scout-runner.ts is out of
// proportion to what this guard needs to lock (that the broadcast call
// exists, at the right producer, gated correctly).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let graduatorSrc: string;
let scoutRunnerSrc: string;
let sseSrc: string;
beforeAll(() => {
  graduatorSrc = readFileSync(resolve(here, "../services/direct-bucket-graduator.ts"), "utf8");
  scoutRunnerSrc = readFileSync(resolve(here, "../services/autonomous-scout-runner.ts"), "utf8");
  sseSrc = readFileSync(resolve(here, "../routes/sse.ts"), "utf8");
});

describe("deepscan15 H4 — FACTORY_EVENTS.STRATEGY_CREATED is no longer dead", () => {
  it("sse.ts still declares the STRATEGY_CREATED constant", () => {
    expect(sseSrc).toContain('STRATEGY_CREATED:           "factory:strategy_created"');
  });

  it("direct-bucket-graduator.ts broadcasts it at the real strategy-created completion point", () => {
    expect(graduatorSrc).toContain("broadcastSSE(FACTORY_EVENTS.STRATEGY_CREATED");
  });

  it("the broadcast fires after the leader strategy row's own log line (real completion point, not aspirational)", () => {
    const logIdx = graduatorSrc.indexOf("direct-graduator: strategy created from bucket");
    const broadcastIdx = graduatorSrc.indexOf("broadcastSSE(FACTORY_EVENTS.STRATEGY_CREATED");
    expect(logIdx).toBeGreaterThan(-1);
    expect(broadcastIdx).toBeGreaterThan(logIdx);
  });
});

describe("deepscan15 H4 — FACTORY_EVENTS.FRAMEWORK_OVERLAY_APPLIED is no longer dead", () => {
  it("sse.ts still declares the FRAMEWORK_OVERLAY_APPLIED constant", () => {
    expect(sseSrc).toContain('FRAMEWORK_OVERLAY_APPLIED:  "factory:framework_overlay_applied"');
  });

  it("direct-bucket-graduator.ts broadcasts it immediately after applyFrameworkOverlay() runs", () => {
    const overlayCallIdx = graduatorSrc.indexOf("const overlayed = applyFrameworkOverlay({");
    const broadcastIdx = graduatorSrc.indexOf("broadcastSSE(FACTORY_EVENTS.FRAMEWORK_OVERLAY_APPLIED");
    expect(overlayCallIdx).toBeGreaterThan(-1);
    expect(broadcastIdx).toBeGreaterThan(overlayCallIdx);
    // Keep the two close together — this must be the leader-overlay call site,
    // not some unrelated later overlay invocation (e.g. the per-variant fan-out).
    expect(broadcastIdx - overlayCallIdx).toBeLessThan(1200);
  });

  it("does not broadcast a second time for the per-variant fan-out overlay (avoids event-flood per graduation)", () => {
    const occurrences = (graduatorSrc.match(/broadcastSSE\(FACTORY_EVENTS\.FRAMEWORK_OVERLAY_APPLIED/g) || []).length;
    expect(occurrences).toBe(1);
  });
});

describe("deepscan15 H4 — FACTORY_EVENTS.SCOUT_IDEA_EXTRACTED is no longer dead", () => {
  it("sse.ts still declares the SCOUT_IDEA_EXTRACTED constant", () => {
    expect(sseSrc).toContain('SCOUT_IDEA_EXTRACTED:       "factory:scout_idea_extracted"');
  });

  it("autonomous-scout-runner.ts broadcasts it from postLayerMention (the single choke point for all 3 layers)", () => {
    const fnIdx = scoutRunnerSrc.indexOf("async function postLayerMention(");
    const broadcastIdx = scoutRunnerSrc.indexOf("broadcastSSE(FACTORY_EVENTS.SCOUT_IDEA_EXTRACTED");
    expect(fnIdx).toBeGreaterThan(-1);
    expect(broadcastIdx).toBeGreaterThan(fnIdx);
  });

  it("is gated on opts.richIdea (distinguishes real LLM extraction from CV-only mentions)", () => {
    const broadcastIdx = scoutRunnerSrc.indexOf("broadcastSSE(FACTORY_EVENTS.SCOUT_IDEA_EXTRACTED");
    expect(broadcastIdx).toBeGreaterThan(-1);
    const before = scoutRunnerSrc.slice(Math.max(0, broadcastIdx - 400), broadcastIdx);
    expect(before).toContain("if (opts.richIdea");
  });
});
