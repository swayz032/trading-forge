/**
 * spec-onboarding-candidate-identity.test.ts — MP-1 lane `L-1`, the PRODUCTION-BOUNDARY RED.
 *
 * AUTHORITY: R-797 §5 lane `L`. This file is committed RED, in its own commit, BEFORE
 * one line of the repair exists.
 *
 *     `ONCE THE REPAIR LANDS YOU CAN NO LONGER PROVE THE RED EVER BOUND PRODUCTION.`
 *
 * WHAT THIS PINS, AND WHY IT IS NOT THE PYTHON CONTRACT AGAIN
 * -----------------------------------------------------------
 * `test_mp1_candidate_persistence.py` proves a Python PLANNER keys on `candidate_id`.
 * It never reaches this file. `AR-940` convicted exactly that gap: those obligations
 * were RED against the planner's ABSENCE, so their green proves the planner exists —
 * NOT that the production collapse is gone.
 *
 * This file is the missing witness. It drives the REAL `onboardSpecArtifact` against a
 * REAL in-process Postgres (PGlite), so what it measures is production's own decision.
 *
 * THE COLLAPSE, AT THE EXECUTABLE LINE (desk-re-verified, R-797 §4)
 * -----------------------------------------------------------------
 * `findExistingOnboardedRow(specHash, symbol)` filters `source` + `symbol` and then
 * matches a `spec_hash:` tag. No candidate dimension appears in that decision, so all
 * three taught candidates ARE duplicates of one another and candidates 2 and 3 return
 * `skipped_duplicate` silently.
 *
 * WHY THE THREE INPUTS MUST DIFFER (this is the part a reader will question)
 * --------------------------------------------------------------------------
 * `L-1` accompanies a MINIMAL production change: `OnboardSpecOptions.executionCandidate`
 * is now accepted. It changes NO idempotency decision — the key is still
 * `(spec_hash, symbol)`. It exists because three IDENTICAL inputs would be a legitimate
 * duplicate even after the repair, so a RED built on identical inputs could never be
 * turned green and would be measuring a missing channel rather than the collapse.
 *
 *     `A RED THE REPAIR CANNOT TURN GREEN IS NOT A RED ABOUT THE REPAIR.`
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers/pglite-db.js";
import type { TestDb } from "../../__tests__/helpers/pglite-db.js";

let injectedDb: TestDb["db"] | null = null;

// DB-CONNECTION seam ONLY. The service itself is the real one — R-797 §6[1] makes a
// mocked service a STOP, and `[test-replica]` records six greens here that survived
// DELETING production.
vi.mock("../../db/index.js", () => ({
  get db() {
    return injectedDb;
  },
}));

vi.mock("../../index.js", () => ({
  logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} },
}));

import { onboardSpecArtifact } from "../spec-onboarding-service.js";
import { strategies } from "../../db/schema.js";

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

const SPEC_HASH = "hash_candidate_identity_001";
const SYMBOL = "MES";

/** ONE parent spec. The three taught candidates are children of THIS artifact. */
function openingRangeParentSpec(): unknown {
  return {
    video: "candidateIdentityVid",
    spec_hash: SPEC_HASH,
    graph_canonical_hash: "graph_candidate_identity",
    ledger_d: "CONSERVED",
    transcript_chars: 5000,
    spec: {
      direction: "long",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "order block entry trigger", role: "trigger", span: { start: 0, end: 10 }, evidence: "T-c-001" },
        { id: "S1", type: "WAIT_SESSION", object: "opening range", role: "spine", span: { start: 10, end: 20 }, evidence: "T-c-002" },
        { id: "C1", type: "FILTER", object: "higher timeframe bias", role: "confluence", span: { start: 20, end: 30 }, evidence: "T-c-003" },
        { id: "C2", type: "WAIT_BIAS", object: "killzone timing", role: "confluence", span: { start: 30, end: 40 }, evidence: "T-c-004" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
      framework_overlay: { stop: "framework_owned", take_profit: "framework_owned", sizing: "framework_owned" },
    },
  };
}

/**
 * The three taught candidates, as OPAQUE identities.
 *
 * 🛑 The ids deliberately encode NO trading semantics. R-797 §6 forbids any
 * timeframe-derived candidate, and a test whose ids read `..._5m` invites the next
 * reader to parse one. The variable NAMES carry the meaning; the VALUES are opaque.
 */
const CANDIDATE_A = { candidateId: "orc_c1f4a9e2", cacheIdentity: "ci_7b21d0", receipt: { schema: "OPENING_RANGE_EXECUTION_CANDIDATE_RECEIPT/1", candidate_id: "orc_c1f4a9e2" } };
const CANDIDATE_B = { candidateId: "orc_9d3e77b0", cacheIdentity: "ci_44ac81", receipt: { schema: "OPENING_RANGE_EXECUTION_CANDIDATE_RECEIPT/1", candidate_id: "orc_9d3e77b0" } };
const CANDIDATE_C = { candidateId: "orc_2a86bf51", cacheIdentity: "ci_e0195c", receipt: { schema: "OPENING_RANGE_EXECUTION_CANDIDATE_RECEIPT/1", candidate_id: "orc_2a86bf51" } };

describe("MP-1 L-1 — three taught candidates at the REAL onboarding boundary", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;
    await ctx.pg.exec(NEEDS_ARCHETYPE_QUEUE_DDL);

    tmpDir = mkdtempSync(join(tmpdir(), "playbook-router-candidate-test-"));
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

  const onboard = (candidate: typeof CANDIDATE_A) =>
    onboardSpecArtifact(openingRangeParentSpec(), {
      dryRun: false,
      symbols: ["MES"],
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
      executionCandidate: candidate,
    });

  const rowsForThisSpec = async () => {
    const all = await ctx.db.select().from(strategies).where(eq(strategies.symbol, SYMBOL));
    return all.filter((r) => Array.isArray(r.tags) && r.tags.includes(`spec_hash:${SPEC_HASH}`));
  };

  /**
   * PRE-REPAIR WITNESS. This one PASSES today and that is the point: it proves the
   * path RAN and that the collapse is real, so the RED below cannot be dismissed as
   * a broken harness.
   *
   *   `A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN.`
   */
  it("PRE-REPAIR WITNESS: candidates B and C are silently swallowed as skipped_duplicate", async () => {
    const a = await onboard(CANDIDATE_A);
    const b = await onboard(CANDIDATE_B);
    const c = await onboard(CANDIDATE_C);

    expect(a.perSymbol.map((p) => p.status)).toEqual(["inserted"]);
    expect(b.perSymbol.map((p) => p.status)).toEqual(["skipped_duplicate"]);
    expect(c.perSymbol.map((p) => p.status)).toEqual(["skipped_duplicate"]);
  });

  /**
   * 🛑 THE RED. This is the money-path requirement and it FAILS against production today.
   */
  it("REQUIREMENT: three taught candidates survive as THREE durable qualification identities", async () => {
    const rows = await rowsForThisSpec();
    expect(rows.length).toBe(3);
  });

  it("REQUIREMENT: each persisted row names the ONE candidate it is", async () => {
    const rows = await rowsForThisSpec();
    const ids = rows.map((r) => (r.config as Record<string, unknown>)?.execution_candidate_id);
    expect(new Set(ids.filter(Boolean)).size).toBe(3);
  });

  /**
   * THE ANTI-OVERSHOOT GUARD (R-797 §5 L-1, explicitly required).
   *
   * Without this, "candidate-aware idempotency works" is indistinguishable from
   * "dedupe was switched off". Replaying the SAME candidate must remain a duplicate
   * both before AND after the repair.
   */
  it("GUARD: replaying the IDENTICAL candidate is still a legitimate duplicate", async () => {
    const replay = await onboard(CANDIDATE_A);
    expect(replay.perSymbol.map((p) => p.status)).toEqual(["skipped_duplicate"]);
  });
});
