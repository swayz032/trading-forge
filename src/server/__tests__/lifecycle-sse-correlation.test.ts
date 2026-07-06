/**
 * lifecycle-sse-correlation.test.ts — deep-scan Observability re-verify F-3 (HIGH).
 *
 * EVERY lifecycle SSE broadcast must carry a `correlationId` (or `tickCorrelationId`) KEY so the
 * operator's live SSE stream joins back to the audit_log / lifecycle_transitions row
 * (CLAUDE.md §2: bar→handler→DB→SSE→audit_log). Source-structural guard.
 *
 * Re-verify #3 hardening — the prior guard was BLIND to the real bug shape twice over:
 *   (a) it matched the identifier `correlationId` ANYWHERE in the body, so `correlation_id: correlationId`
 *       (snake_case key, 11 sites) passed GREEN despite the SSE consumer key being wrong. This version
 *       requires `correlationId` as a KEY (shorthand `correlationId,` or explicit `correlationId:`), so a
 *       value-position match after `: ` (e.g. `correlation_id: correlationId`) correctly FAILS.
 *   (b) it only matched `broadcastSSE(LIFECYCLE_GATE_EVENTS.*` — 5 raw-string `broadcastSSE("lifecycle:…"`
 *       HARD-gate broadcasts (dsl_guards) were structurally unreachable. This version matches BOTH.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// deep-scan Obs re-verify #4: scan EVERY file that emits lifecycle:* SSE, not just lifecycle-service.ts.
// scheduler.ts + operator-absent-mode-service.ts share the lifecycle:* namespace and hid F-NEW-2
// (scheduler lifecycle:auto-check dropped correlationId) from 4 rounds of a single-file guard.
const SRC_FILES = [
  "src/server/services/lifecycle-service.ts",
  "src/server/scheduler.ts",
  "src/server/services/operator-absent-mode-service.ts",
];

// Match a lifecycle SSE broadcast via EITHER the catalog constant OR a raw "lifecycle:*" string literal.
const BROADCAST_RE =
  /broadcastSSE\(\s*(?:LIFECYCLE_GATE_EVENTS\.(\w+)|"(lifecycle:[^"]+)")\s*,\s*\{([\s\S]*?)\}\)/g;

// correlationId/tickCorrelationId must appear as a KEY: preceded by `{`, `,`, or line-start (+ ws),
// and followed by `,`, `:`, or `}`. This rejects a value-position match after `: ` (the snake_case bug).
const KEY_RE = /(?:^|[{,])\s*(?:correlationId|tickCorrelationId)\s*[,:}]/m;

function collect() {
  const sites: Array<{ file: string; event: string; body: string }> = [];
  for (const file of SRC_FILES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(BROADCAST_RE)) {
      sites.push({ file: file.split("/").pop() ?? file, event: m[1] ?? m[2] ?? "?", body: m[3] ?? "" });
    }
  }
  return sites;
}

describe("lifecycle SSE events carry a correlationId KEY (F-3, all events incl. raw-string)", () => {
  it("every lifecycle broadcastSSE payload has correlationId/tickCorrelationId as a KEY", () => {
    const sites = collect();
    // 33 catalog-constant + 5 raw-string dsl_guards = 38 lifecycle SSE sites today. Guard against the
    // regex silently matching zero (the "detector found nothing so everything passes" failure mode).
    expect(sites.length).toBeGreaterThanOrEqual(35);

    const offenders = sites
      .filter((s) => !KEY_RE.test(s.body))
      .map((s) => `${s.file}:${s.event}: ${s.body.replace(/\s+/g, " ").trim().slice(0, 80)}`);

    expect(offenders, `lifecycle SSE broadcasts missing a correlationId KEY:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("rejects the snake_case key bug shape (mutation-resistance sanity)", () => {
    // The exact bug the prior guard missed: value-position identifier under a snake_case key.
    expect(KEY_RE.test("strategyId: id, correlation_id: correlationId, reason: x")).toBe(false);
    // And genuinely accepts both key forms actually used in the file.
    expect(KEY_RE.test("strategyId: id, correlationId, reason: x")).toBe(true);       // shorthand
    expect(KEY_RE.test("strategyId: id,\n  correlationId: options.correlationId ?? null,")).toBe(true); // explicit
    expect(KEY_RE.test("strategyId: id,\n  tickCorrelationId,")).toBe(true);          // tick variant
  });

  it("explicitly covers the known live-capital gate surfaces (incl. the raw-string dsl_guards HARD gate)", () => {
    const sites = collect();
    for (const evt of [
      "PROMOTED",
      "PAPER_TO_DEPLOY_READY_BLOCKED",
      "BIF_EVALUATED",
      "B14_EVALUATED",
      "WFE_EVALUATED",
      "DSL_GUARDS_EVALUATED", // now emitted via the catalog constant (was a raw "lifecycle:…" string)
    ]) {
      const matching = sites.filter((s) => s.event === evt || `LIFECYCLE_GATE_EVENTS.${s.event}` === `LIFECYCLE_GATE_EVENTS.${evt}`);
      const found = sites.filter((s) => s.event === evt);
      expect(found.length, `expected at least one ${evt} broadcast`).toBeGreaterThanOrEqual(1);
      for (const s of found) {
        expect(KEY_RE.test(s.body), `${evt} broadcast missing correlationId KEY`).toBe(true);
      }
      void matching;
    }
  });
});
