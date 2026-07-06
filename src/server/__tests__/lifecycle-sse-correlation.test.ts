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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// deep-scan Obs re-verify #5: DISCOVER every emitter file programmatically rather than maintain a
// hardcoded list. A static SRC_FILES list is exactly the blind-spot class that hid F-NEW-2 (scheduler)
// and portfolio-drift-demotion-service.ts — a guard that must be re-listed per new emitter file is
// exhaustive-for-now, not comprehensive. Walk src/server for every non-test .ts that emits a lifecycle
// SSE and scan it, so any future emitter file is covered automatically.
function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "__tests__" || ent.name === "node_modules") continue;
      out.push(...walkTsFiles(full));
    } else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

// deep-scan Obs re-verify #6: CATALOG-AGNOSTIC. lifecycle SSE events live in MORE THAN ONE catalog
// object (LIFECYCLE_GATE_EVENTS *and* WAVE29_EVENTS — e.g. PBO_EVALUATED / SHADOW_DIVERGENCE_EVALUATED,
// both HARD promotion gates). A regex hardcoding `LIFECYCLE_GATE_EVENTS` missed 8 live WAVE29 sites.
// So: parse sse.ts for EVERY `KEY: "lifecycle:…"` entry across ALL `*_EVENTS` objects, then match any
// `broadcastSSE(<anything>.KEY, {…})` whose KEY resolves to a lifecycle:* value, plus raw "lifecycle:*".
function lifecycleEventKeys(): Set<string> {
  const sse = readFileSync("src/server/routes/sse.ts", "utf8");
  const keys = new Set<string>();
  for (const m of sse.matchAll(/(\w+)\s*:\s*"(lifecycle:[^"]+)"/g)) {
    keys.add(m[1]); // the SCREAMING_SNAKE catalog key whose value is a lifecycle:* event
  }
  return keys;
}
const LIFECYCLE_KEYS = lifecycleEventKeys();

// Match broadcastSSE(<Obj>.<KEY>, {body}) OR broadcastSSE("lifecycle:*", {body}).
const BROADCAST_RE =
  /broadcastSSE\(\s*(?:(\w+)\.(\w+)|"(lifecycle:[^"]+)")\s*,\s*\{([\s\S]*?)\}\)/g;

// correlationId/tickCorrelationId must appear as a KEY: preceded by `{`, `,`, or line-start (+ ws),
// and followed by `,`, `:`, or `}`. This rejects a value-position match after `: ` (the snake_case bug).
const KEY_RE = /(?:^|[{,])\s*(?:correlationId|tickCorrelationId)\s*[,:}]/m;

function collect() {
  const sites: Array<{ file: string; event: string; body: string }> = [];
  for (const file of walkTsFiles("src/server")) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("broadcastSSE")) continue;
    for (const m of src.matchAll(BROADCAST_RE)) {
      const rawLifecycle = m[3];            // "lifecycle:*" literal
      const objKey = m[2];                  // KEY in <Obj>.<KEY>
      // Only lifecycle SSE: a raw "lifecycle:*" literal, OR an <Obj>.KEY whose KEY resolves (via sse.ts)
      // to a lifecycle:* value — regardless of WHICH catalog object (LIFECYCLE_GATE_EVENTS/WAVE29_EVENTS/…).
      if (!rawLifecycle && !(objKey && LIFECYCLE_KEYS.has(objKey))) continue;
      const event = rawLifecycle ?? `${m[1]}.${objKey}`;
      sites.push({ file: file.split(/[\\/]/).pop() ?? file, event, body: m[4] ?? "" });
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

  it("explicitly covers the known live-capital gate surfaces (across BOTH catalogs + raw-string)", () => {
    const sites = collect();
    // event is now "<Catalog>.KEY" (e.g. LIFECYCLE_GATE_EVENTS.PROMOTED / WAVE29_EVENTS.PBO_EVALUATED)
    // or a raw "lifecycle:*" literal. Match by the KEY suffix so the check is catalog-agnostic.
    for (const key of [
      "PROMOTED",
      "PAPER_TO_DEPLOY_READY_BLOCKED",
      "BIF_EVALUATED",
      "B14_EVALUATED",
      "WFE_EVALUATED",
      "DSL_GUARDS_EVALUATED",
      "PBO_EVALUATED",                 // WAVE29_EVENTS — HARD gate, was invisible to the pre-#6 guard
      "SHADOW_DIVERGENCE_EVALUATED",   // WAVE29_EVENTS — HARD gate
    ]) {
      const found = sites.filter((s) => s.event === key || s.event.endsWith(`.${key}`));
      expect(found.length, `expected at least one ${key} broadcast`).toBeGreaterThanOrEqual(1);
      for (const s of found) {
        expect(KEY_RE.test(s.body), `${key} broadcast missing correlationId KEY`).toBe(true);
      }
    }
  });
});
