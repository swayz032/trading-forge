/**
 * spec-onboarding-service.bandc.test.ts — Band C (spec-execution-semantics, 2026-07-02)
 *
 * pglite integration tests for the NEW condition-family-compiler routing added
 * to onboardSpecArtifact(): specs that don't match a named archetype (Band B)
 * but DO clear the binding-plan coverage threshold (spec-family-bindings.ts)
 * now route to CANDIDATE with a `spec_conditions:<hash>` marker instead of
 * NEEDS_ARCHETYPE — see spec-onboarding-service.ts's `conditionCompiled` branch.
 *
 * A SEPARATE file from Band B's spec-onboarding-service.test.ts (not edited)
 * to keep file ownership clean and avoid merge collisions; reuses the exact
 * same pglite bootstrap pattern.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers/pglite-db.js";
import type { TestDb } from "../../__tests__/helpers/pglite-db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// repo root: src/server/services/__tests__ -> up 4 levels
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

let injectedDb: TestDb["db"] | null = null;

vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

vi.mock("../../index.js", () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

import { onboardSpecArtifact } from "../spec-onboarding-service.js";
import { strategies, needsArchetypeQueue } from "../../db/schema.js";

const NEEDS_ARCHETYPE_QUEUE_DDL = `
CREATE TABLE IF NOT EXISTS needs_archetype_queue (
  id                       BIGSERIAL PRIMARY KEY,
  bucket_id                UUID NULL,
  speaker_term             TEXT NOT NULL,
  verbatim_description     TEXT NULL,
  transcript_quote         TEXT NULL,
  source_url               TEXT NULL,
  extraction_count         INTEGER NOT NULL DEFAULT 1,
  proposed_archetype_name  TEXT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT needs_archetype_queue_status_check CHECK (status IN ('pending', 'archetype_created', 'rejected'))
);
CREATE UNIQUE INDEX IF NOT EXISTS needs_archetype_queue_term_idx ON needs_archetype_queue (speaker_term);
`;

// A spec with no ICT/archetype keyword vocabulary, but a REAL spine condition
// (WAIT_SESSION with a recognized session keyword) that clears the Band C
// binding-plan coverage threshold — this must NOT go to needs_archetype.
function conditionCompilableSpec(specHash: string, video: string): unknown {
  return {
    video,
    spec_hash: specHash,
    graph_canonical_hash: "graph_cc",
    ledger_d: "CONSERVED",
    transcript_chars: 3000,
    spec: {
      direction: "long",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "buying opportunity", role: "trigger", span: { start: 0, end: 10 }, evidence: "T-cc-001" },
        { id: "S1", type: "WAIT_SESSION", object: "ny am session", role: "spine", span: { start: 10, end: 20 }, evidence: "T-cc-002" },
        { id: "C1", type: "FILTER", object: "general market tone", role: "confluence", span: { start: 20, end: 30 }, evidence: "T-cc-003" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [
        { id: "I1", type: "INVALIDATE", object: "structural break below level", role: "invalidation", span: { start: 30, end: 40 }, evidence: "T-cc-004" },
      ],
      entry_trigger_id: "T1",
    },
  };
}

// A spec whose only spine condition is control-flow (RESET) — unbindable, so
// the binding plan must stay queued but attach a PER-CONDITION reason.
function stillUnbindableSpec(specHash: string, video: string): unknown {
  return {
    video,
    spec_hash: specHash,
    graph_canonical_hash: "graph_unb",
    ledger_d: "CONSERVED",
    transcript_chars: 1000,
    spec: {
      direction: "long",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "generic entry", role: "trigger", span: { start: 0, end: 10 }, evidence: "T-un-001" },
        { id: "S1", type: "RESET", object: "reset the setup", role: "spine", span: { start: 10, end: 20 }, evidence: "T-un-002" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
    },
  };
}

describe("spec-onboarding-service — Band C condition-family-compiler routing", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;
    await ctx.pg.exec(NEEDS_ARCHETYPE_QUEUE_DDL);

    tmpDir = mkdtempSync(join(tmpdir(), "playbook-router-bandc-test-"));
    playbookRouterPath = join(tmpDir, "playbook_router_fixture.py");
    writeFileSync(
      playbookRouterPath,
      [
        'CONTINUATION_STRATS = ["ote", "ict_swing", "propulsion"]',
        'REVERSAL_STRATS = ["breaker", "eqhl_raid"]',
        'MEAN_REV_STRATS = ["ny_lunch_reversal", "midnight_open"]',
        'ORB_STRATS = ["iofed", "ict_scalp"]',
        "ALL_STRATS = CONTINUATION_STRATS + REVERSAL_STRATS + MEAN_REV_STRATS + ORB_STRATS",
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterAll(async () => {
    await ctx.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("CONDITION-COMPILED: unmatched archetype but binding plan clears threshold -> CANDIDATE, spec_conditions marker, no needs_archetype_queue row", async () => {
    const result = await onboardSpecArtifact(conditionCompilableSpec("hash_cc_001", "ccVid001"), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(true);
    expect(result.archetypeMatch?.matched).toBe(false);
    expect(result.conditionCompiled).toBe(true);
    expect(result.bindingPlan?.compiled).toBe(true);
    expect(result.bindingPlan?.triggerBound).toBe(true);
    expect(result.bindingPlan?.spineTotal).toBe(1);
    expect(result.bindingPlan?.spineBound).toBe(1);

    for (const p of result.perSymbol) {
      expect(p.status).toBe("inserted");
      expect(p.lifecycleState).toBe("CANDIDATE");
      expect(p.needsArchetype).toBe(false);
    }

    const mesResult = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mesResult.strategyId!));
    expect(row.lifecycleState).toBe("CANDIDATE");
    expect(row.tags).toContain("condition_compiled");
    expect(row.tags).not.toContain("needs_archetype");

    const config = row.config as Record<string, unknown>;
    const strategyBlock = config.strategy as Record<string, unknown>;
    expect(String(strategyBlock.entry_indicator)).toMatch(/^spec_conditions:/);

    const compiledSpec = config.compiled_spec as Record<string, unknown>;
    const summary = compiledSpec.binding_plan_summary as Record<string, unknown>;
    expect(summary.compiled).toBe(true);
    expect(summary.spine_bound).toBe(1);
    expect(summary.spine_total).toBe(1);

    // Must NOT be parked in needs_archetype_queue — it's executable now.
    const queueRows = await ctx.db.select().from(needsArchetypeQueue);
    const matching = queueRows.filter((q) => q.sourceUrl === "https://www.youtube.com/watch?v=ccVid001");
    expect(matching.length).toBe(0);
  });

  it("STILL-UNBINDABLE: archetype unmatched AND binding plan fails threshold -> NEEDS_ARCHETYPE with PER-CONDITION reason attached", async () => {
    const result = await onboardSpecArtifact(stillUnbindableSpec("hash_unb_001", "unbVid001"), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(true);
    expect(result.archetypeMatch?.matched).toBe(false);
    expect(result.conditionCompiled).toBe(false);
    expect(result.bindingPlan?.compiled).toBe(false);
    expect(result.bindingPlan?.queueReasons.some((r) => r.reason === "control_flow_reset_unsupported")).toBe(true);

    for (const p of result.perSymbol) {
      expect(p.lifecycleState).toBe("NEEDS_ARCHETYPE");
      expect(p.needsArchetype).toBe(true);
    }

    const queueRows = await ctx.db.select().from(needsArchetypeQueue);
    const matching = queueRows.filter((q) => q.sourceUrl === "https://www.youtube.com/watch?v=unbVid001");
    expect(matching.length).toBe(1);
    // Per-condition reason (not a blanket rejection message) is appended.
    expect(matching[0].verbatimDescription).toContain("control_flow_reset_unsupported");
  });

  it("OVERLAY-VISIBLE: a condition-compiled onboarded strategy's REGISTERED name makes apply_eligibility_gate's Mode A/B toggle meaningful (closes the B2-class overlay-bypass bug)", async () => {
    // 1. Run the REAL onboarding pipeline end-to-end (same as the
    //    CONDITION-COMPILED test above) -- this is what B2 playbook
    //    registration actually writes to playbookRouterPath.
    const result = await onboardSpecArtifact(conditionCompilableSpec("hash_ov_001", "ovVid001"), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(result.conditionCompiled).toBe(true);

    const mesResult = result.perSymbol.find((p) => p.symbol === "MES")!;
    expect(mesResult.status).toBe("inserted");
    const registeredName = mesResult.strategyName;

    // 2. Prove the EXACT registered name landed in playbook_router.py (the
    //    same file apply_eligibility_gate's ALL_STRATS check reads from in
    //    production) -- not just that registration reported ok=true.
    const routerSource = readFileSync(playbookRouterPath, "utf-8");
    expect(routerSource).toContain(registeredName);
    const category = mesResult.playbookCategory!;
    expect(routerSource).toMatch(new RegExp(`${category}\\s*=\\s*\\[[^\\]]*"${registeredName}"`));

    // 3. Prove that name, once passed as SpecConditionStrategy.name (the
    //    Band C engine-side fix -- backtester.py threads config.strategy.name
    //    into from_compiled_spec(strategy_name=...)), makes
    //    apply_eligibility_gate() actually distinguish Mode A from Mode B.
    //    Non-mocked: real Python subprocess, real apply_eligibility_gate.
    // apply_eligibility_gate() does `from src.engine.context.playbook_router
    // import ALL_STRATS` -- a hardcoded module import, not a path parameter.
    // The temp playbookRouterPath file exercises the SAME text-parsing
    // registerStrategiesInPlaybook() writes to (proving the write mechanism
    // works), but production's actual ALL_STRATS lives in the real module.
    // To prove the EXACT registered content (not just a hand-written fixture
    // name) satisfies the gate without mutating the real production source
    // file during a test run, this driver loads the temp file as a module
    // and monkeypatches the real module's ALL_STRATS to that parsed content
    // before calling the gate -- the same value production would have after
    // a real registration write.
    const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(REPO_ROOT)})
import numpy as np
import polars as pl
import importlib.util

spec = importlib.util.spec_from_file_location("temp_playbook_router", ${JSON.stringify(playbookRouterPath)})
temp_router = importlib.util.module_from_spec(spec)
spec.loader.exec_module(temp_router)

import src.engine.context.playbook_router as real_router
real_router.ALL_STRATS = temp_router.ALL_STRATS

from src.engine.backtester import apply_eligibility_gate

assert ${JSON.stringify(registeredName)} in real_router.ALL_STRATS, "registered name not found in parsed playbook content"

n = 50
df = pl.DataFrame({"close": np.linspace(5000, 5010, n), "ts_event": [None] * n})
entries = np.zeros(n, dtype=bool)
entries[10] = True
exits = np.zeros(n, dtype=bool)
htf_cache = {"2026-01-05": object()}

import os
os.environ.pop("TF_CONFLUENCE_OVERLAY_DISABLED", None)
_, _, stats_a = apply_eligibility_gate(entries, exits, df, "long", "MES", htf_cache=htf_cache, strategy_name=${JSON.stringify(registeredName)})

os.environ["TF_CONFLUENCE_OVERLAY_DISABLED"] = "true"
_, _, stats_b = apply_eligibility_gate(entries, exits, df, "long", "MES", htf_cache=htf_cache, strategy_name=${JSON.stringify(registeredName)})

print(json.dumps({"mode_a": stats_a.get("mode"), "mode_b": stats_b.get("mode")}))
`;
    const proc = spawnSync("python", ["-c", driver], { encoding: "utf-8", cwd: REPO_ROOT });
    expect(proc.status, `python driver stderr: ${proc.stderr}`).toBe(0);
    const parsed = JSON.parse(proc.stdout.trim());

    expect(parsed.mode_a).toBe("tf_institutional_overlay");
    expect(parsed.mode_b).toBe("source_entry_only");
    expect(parsed.mode_a).not.toBe(parsed.mode_b);
  });
});
