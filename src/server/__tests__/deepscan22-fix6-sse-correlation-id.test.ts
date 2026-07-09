/**
 * deepscan22-fix6-sse-correlation-id.test.ts — deep-scan #22 fix #6 (HIGH).
 *
 * `correlationId` was in local scope (used in the paired audit_log insert) at ~25
 * broadcastSSE(...) call sites across kill-switch.ts, paper-execution-service.ts, and
 * lifecycle-service.ts, but was omitted from the SSE payload — breaking the
 * bar → handler → DB → SSE → audit_log reconstruction chain (CLAUDE.md §2) for those
 * specific events, several of them SAFETY-CRITICAL (kill-switch, compliance/exportability
 * gate blocks, deploy-ready promotion).
 *
 * This is a source-structural guard (no DB, no mocks — mirrors migration-immutability-guard.test.ts
 * and lifecycle-sse-correlation.test.ts): it statically extracts every broadcastSSE(...) call body
 * from the three named files and asserts `correlationId` appears as a KEY (not merely as a value
 * under a different key, e.g. `correlation_id: correlationId` — see KEY_RE below), except for a
 * short, individually-commented ALLOWLIST of sites where correlationId is genuinely not in scope
 * (aggregate/multi-position events, or helper functions that don't receive it as a parameter).
 *
 * Do NOT add an entry to ALLOWLIST to silence a real regression — every addition must document
 * WHY correlationId cannot be threaded to that specific call site.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FILES = [
  "src/server/production/kill-switch.ts",
  "src/server/services/paper-execution-service.ts",
  "src/server/services/lifecycle-service.ts",
] as const;

// Same convention as lifecycle-sse-correlation.test.ts: require `correlationId` as a KEY
// (shorthand `correlationId,` or explicit `correlationId: ...`), not merely present as an
// identifier somewhere in the body (which would wrongly pass `correlation_id: correlationId`).
const KEY_RE = /(?:^|[{,])\s*correlationId\s*[,:}]/m;

// Matches broadcastSSE("literal:event", {body}) OR broadcastSSE(Obj.KEY, {body}).
// Lazy body capture relies on this codebase's convention of closing the call as `});`
// (closing brace immediately followed by closing paren) — the same heuristic already
// proven across 46+ sites in lifecycle-sse-correlation.test.ts.
const BROADCAST_RE = /broadcastSSE\(\s*(?:"([^"]+)"|(\w+(?:\.\w+)?))\s*,\s*\{([\s\S]*?)\}\)/g;

// Sites where correlationId is genuinely NOT in scope, OR is already present under a
// different (equally valid, pre-existing) key convention — each entry documents why.
// Keyed by "<file basename>:<event label>".
const ALLOWLIST = new Set<string>([
  // Session-wide aggregate P&L across ALL open positions — not tied to any single
  // position's correlationId; attaching one arbitrarily would misattribute the event.
  "paper-execution-service.ts:paper:pnl",
  // checkConsistencyRule(session) does not receive correlationId as a parameter — it is
  // a firm-wide consistency read, not a single traceable decision. Threading it through
  // would require a signature change beyond this fix's scope.
  "paper-execution-service.ts:paper:consistency-warning",
  // updateRollingMetrics(sessionId, strategyId) does not receive correlationId as a
  // parameter — same reasoning as consistency-warning above.
  "paper-execution-service.ts:paper:decay-alert",
  "paper-execution-service.ts:paper:decay-warning",
  // The PAPER_EXIT_EVENTS.* family (style-exit handler payloads) intentionally uses a
  // consistent snake_case wire shape mirroring the Python exit-handler contract
  // (position_id / strategy_id / decision_type / exit_style / correlation_id) — already
  // carries the id, just under `correlation_id` rather than this guard's canonical
  // camelCase `correlationId` key. Pre-existing, not touched by deep-scan #22 fix #6.
  "paper-execution-service.ts:PAPER_EXIT_EVENTS.HANDLER_ERROR",
  "paper-execution-service.ts:PAPER_EXIT_EVENTS.TRAIL_TIGHTENED",
]);

function collectSites(file: string) {
  const src = readFileSync(file, "utf8");
  const base = file.split(/[\\/]/).pop()!;
  const sites: Array<{ key: string; event: string; body: string }> = [];
  for (const m of src.matchAll(BROADCAST_RE)) {
    const event = m[1] ?? m[2]!;
    sites.push({ key: `${base}:${event}`, event, body: m[3] ?? "" });
  }
  return sites;
}

describe("deep-scan #22 fix #6 — safety/lifecycle SSE broadcasts carry correlationId", () => {
  it("every broadcastSSE site in kill-switch.ts / paper-execution-service.ts / lifecycle-service.ts carries a correlationId KEY, except the documented ALLOWLIST", () => {
    const allSites = FILES.flatMap((f) => collectSites(f));
    // Guard against the regex silently matching zero (the "detector found nothing so
    // everything trivially passes" failure mode).
    expect(allSites.length).toBeGreaterThanOrEqual(60);

    const offenders = allSites
      .filter((s) => !ALLOWLIST.has(s.key))
      // The capture group excludes the object literal's closing "}" (it's consumed by the
      // outer regex's \}\) ), so a correlationId that is the LAST field (no trailing comma)
      // has no following delimiter within the captured body — append one back for the check.
      .filter((s) => !KEY_RE.test(`${s.body}}`))
      .map((s) => `${s.key}: ${s.body.replace(/\s+/g, " ").trim().slice(0, 100)}`);

    expect(
      offenders,
      `SSE broadcasts missing a correlationId KEY (not allowlisted):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("explicitly pins the deep-scan #22 fix #6 named safety-critical sites", () => {
    const allSites = FILES.flatMap((f) => collectSites(f));
    const pinned = [
      "kill-switch.ts:kill_switch:c1_cme_eval_failed",
      "paper-execution-service.ts:paper:kill-switch-threshold-tripped",
      "paper-execution-service.ts:paper:roll-spread-applied",
      "lifecycle-service.ts:strategy:compliance_blocked",
      "lifecycle-service.ts:strategy:exportability_blocked",
      "lifecycle-service.ts:strategy:deploy-ready",
    ];
    for (const key of pinned) {
      const found = allSites.filter((s) => s.key === key);
      expect(found.length, `expected at least one broadcastSSE site for ${key}`).toBeGreaterThanOrEqual(1);
      for (const s of found) {
        expect(KEY_RE.test(`${s.body}}`), `${key} broadcast missing correlationId KEY`).toBe(true);
      }
    }
  });

  it("rejects the snake_case value-position bug shape (mutation-resistance sanity)", () => {
    expect(KEY_RE.test("strategyId: id, correlation_id: correlationId, reason: x")).toBe(false);
    expect(KEY_RE.test("strategyId: id, correlationId, reason: x")).toBe(true);
    expect(KEY_RE.test("strategyId: id,\n  correlationId: correlationId ?? null,")).toBe(true);
  });
});
