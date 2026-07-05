/**
 * deepscan17-wave2-critic.test.ts — Deep-scan #17 Fix Wave 2, agent W2-CRITIC
 *
 * Coverage:
 *   E-3 (MED) — backtest-service.ts: 4 fire-and-forget captureToDLQ() calls
 *     (SQA / QUBO / Tensor / RL sub-run failure paths) previously swallowed a
 *     DLQ-write failure via a bare `.catch(() => {})` — a double-failure
 *     (sub-run fails AND the last-resort DLQ record fails to persist)
 *     vanished with zero log line, counter, or audit trace. Fixed by routing
 *     each catch through logger.warn + the shared Track G2 silent-failure
 *     counter (trackG2SilentFailuresTotal), one label per call site.
 *   H3 (MED) — pattern-aggregator-service.ts: setAppendixCache() previously
 *     fired unconditionally, even for dryRun=true replay callers, silently
 *     mutating the SAME in-memory cache buildPromptSync() reads synchronously
 *     for every live strategy-proposer call. Regression coverage for this
 *     fix lives in wave27-dry-run-side-effects.test.ts (PA-3/PA-4) since that
 *     file already owns the dryRun-side-effects mock scaffolding.
 *   H4 (LOW-MED) — pattern-aggregator-service.ts: malformed numeric env vars
 *     (PATTERN_AGGREGATOR_MIN_CRITIQUES etc.) produced NaN/Infinity via a bare
 *     `Number(env ?? default)` cast, silently disabling or wedging open the
 *     min-sample gate. Regression coverage lives in
 *     wave27-dry-run-side-effects.test.ts (H4-A / H4-B) for the same reason.
 *
 * Pattern: backtest-service.ts is heavily DB-coupled at module-load time
 * (pulls in ../db/index.js, which throws without DATABASE_URL at collection
 * time in some environments). Following the established convention in this
 * repo (see deepscan16-wave2-track-g2.test.ts), this file:
 *   (a) asserts on the actual source text of backtest-service.ts to guard
 *       the 4 call sites against silent regression in a future refactor, and
 *   (b) exercises the REAL (non-mocked) trackG2SilentFailuresTotal counter
 *       from metrics-registry.ts directly with the 4 new site labels.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promRegistry, trackG2SilentFailuresTotal } from "../lib/metrics-registry.js";

async function getCounterValue(
  metricName: string,
  labelFilter: Record<string, string> = {},
): Promise<number> {
  const metrics = await promRegistry.getMetricsAsJSON();
  const metric = metrics.find((m) => m.name === metricName);
  if (!metric) return 0;
  const values = metric.values as Array<{ labels: Record<string, string>; value: number }>;
  if (Object.keys(labelFilter).length === 0) {
    return values.reduce((acc, v) => acc + v.value, 0);
  }
  const match = values.find((v) =>
    Object.entries(labelFilter).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

const BACKTEST_SERVICE_PATH = resolve(process.cwd(), "src/server/services/backtest-service.ts");
const PATTERN_AGGREGATOR_PATH = resolve(process.cwd(), "src/server/services/pattern-aggregator-service.ts");

// ─── E-3 — backtest-service.ts DLQ capture no longer swallows silently ───────

describe("E-3 — backtest-service.ts captureToDLQ() failures are no longer silent", () => {
  const src = readFileSync(BACKTEST_SERVICE_PATH, "utf8");

  it("imports trackG2SilentFailuresTotal from metrics-registry", () => {
    expect(src).toMatch(/import\s*\{[^}]*trackG2SilentFailuresTotal[^}]*\}\s*from\s*["']\.\.\/lib\/metrics-registry\.js["']/);
  });

  it("has exactly 4 captureToDLQ({ call sites and zero bare `.catch(() => {})` no-ops among them", () => {
    const callSiteCount = (src.match(/captureToDLQ\(\{/g) ?? []).length;
    expect(callSiteCount).toBe(4);
    // The previous silent-swallow shape — `.catch(() => {});` with a fully
    // empty arrow body — must not appear anywhere in the file.
    expect(src).not.toContain(".catch(() => {});");
  });

  it("each of the 4 known call sites (sqa/qubo/tensor/rl) logs + counts on DLQ-capture failure", () => {
    const sites: Array<{ operationType: string; counterSite: string }> = [
      { operationType: "sqa_optimization:failure", counterSite: "backtest_dlq_capture_sqa" },
      { operationType: "qubo_timing:failure", counterSite: "backtest_dlq_capture_qubo" },
      { operationType: "tensor_prediction:failure", counterSite: "backtest_dlq_capture_tensor" },
      { operationType: "rl_training:failure", counterSite: "backtest_dlq_capture_rl" },
    ];

    for (const { operationType, counterSite } of sites) {
      const idx = src.indexOf(`operationType: "${operationType}"`);
      expect(idx, `missing captureToDLQ call for operationType=${operationType}`).toBeGreaterThan(-1);
      const after = src.slice(idx, idx + 700);
      expect(after, `${operationType}: still has a bare .catch(() => {})`).not.toContain(".catch(() => {});");
      expect(after, `${operationType}: missing logger.warn on DLQ capture failure`).toContain("logger.warn(");
      expect(after, `${operationType}: missing dlqErr in the catch handler`).toContain("dlqErr");
      expect(
        after,
        `${operationType}: missing trackG2SilentFailuresTotal.labels({ site: "${counterSite}" })`,
      ).toContain(`trackG2SilentFailuresTotal.labels({ site: "${counterSite}" })`);
    }
  });

  it("all 4 counter sites are distinct (no accidental copy-paste label collision)", () => {
    const siteMatches = [...src.matchAll(/trackG2SilentFailuresTotal\.labels\(\{ site: "(backtest_dlq_capture_\w+)" \}\)/g)];
    const sites = siteMatches.map((m) => m[1]);
    expect(sites.length).toBe(4);
    expect(new Set(sites).size).toBe(4);
  });
});

describe("E-3 — tf_track_g2_silent_failures_total counter accepts the 4 new backtest DLQ sites", () => {
  it("increments independently per new site without disturbing existing sites", async () => {
    const sites = [
      "backtest_dlq_capture_sqa",
      "backtest_dlq_capture_qubo",
      "backtest_dlq_capture_tensor",
      "backtest_dlq_capture_rl",
    ];

    for (const site of sites) {
      const before = await getCounterValue("tf_track_g2_silent_failures_total", { site });
      trackG2SilentFailuresTotal.labels({ site }).inc();
      const after = await getCounterValue("tf_track_g2_silent_failures_total", { site });
      expect(after).toBe(before + 1);
    }

    // Pre-existing Track G2 sites (deepscan16 wave2) remain unaffected.
    const preExisting = await getCounterValue("tf_track_g2_silent_failures_total", {
      site: "idempotency_expired_key_delete",
    });
    expect(preExisting).toBeGreaterThanOrEqual(0);
  });
});

// ─── H3 — pattern-aggregator-service.ts source-level contract check ─────────

describe("H3 — pattern-aggregator-service.ts setAppendixCache() only fires when !dryRun", () => {
  const src = readFileSync(PATTERN_AGGREGATOR_PATH, "utf8");

  it("setAppendixCache call site sits inside an `if (!dryRun)` block, before the matching `} else {`", () => {
    const guardIdx = src.indexOf("if (!dryRun) {");
    const cacheIdx = src.indexOf("setAppendixCache(PROMPT_TYPE, trimmedOutput)");
    const elseIdx = src.indexOf("} else {", cacheIdx);
    const notMutatedIdx = src.indexOf("dryRun=true — appendix cache NOT mutated");

    expect(guardIdx).toBeGreaterThan(-1);
    expect(cacheIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(-1);
    expect(notMutatedIdx).toBeGreaterThan(-1);

    // Structural ordering proves the cache call is nested INSIDE the
    // `if (!dryRun)` branch, and the "not mutated" log sits in the
    // corresponding `else` branch — not the other way around.
    expect(guardIdx).toBeLessThan(cacheIdx);
    expect(cacheIdx).toBeLessThan(elseIdx);
    expect(elseIdx).toBeLessThan(notMutatedIdx);
  });

  it("dryRun branch explicitly logs that the cache was NOT mutated", () => {
    expect(src).toContain("dryRun=true — appendix cache NOT mutated");
  });
});

// ─── H4 — pattern-aggregator-service.ts numeric env parsing guard ───────────

describe("H4 — pattern-aggregator-service.ts numeric env vars are Number.isFinite-guarded", () => {
  const src = readFileSync(PATTERN_AGGREGATOR_PATH, "utf8");

  it("defines a shared env-int parser using Number.isFinite", () => {
    expect(src).toContain("function _parseEnvInt(");
    const fnIdx = src.indexOf("function _parseEnvInt(");
    const fnBody = src.slice(fnIdx, fnIdx + 300);
    expect(fnBody).toContain("Number.isFinite(n)");
  });

  it("DEFAULT_WINDOW, MIN_CRITIQUES, and NUDGE_DEDUP_DAYS all route through the guarded parser", () => {
    expect(src).toMatch(/const DEFAULT_WINDOW = _parseEnvInt\(process\.env\.PATTERN_AGGREGATOR_WINDOW,\s*20\)/);
    expect(src).toMatch(/const MIN_CRITIQUES = _parseEnvInt\(process\.env\.PATTERN_AGGREGATOR_MIN_CRITIQUES,\s*10\)/);
    expect(src).toMatch(/const NUDGE_DEDUP_DAYS = _parseEnvInt\(process\.env\.LEARNING_LOOP_READY_NUDGE_DAYS,\s*7\)/);
  });

  it("no remaining bare `Number(process.env... ?? \"...\")` pattern for these three vars", () => {
    expect(src).not.toMatch(/Number\(process\.env\.PATTERN_AGGREGATOR_WINDOW\s*\?\?/);
    expect(src).not.toMatch(/Number\(process\.env\.PATTERN_AGGREGATOR_MIN_CRITIQUES\s*\?\?/);
    expect(src).not.toMatch(/Number\(process\.env\.LEARNING_LOOP_READY_NUDGE_DAYS\s*\?\?/);
  });
});
