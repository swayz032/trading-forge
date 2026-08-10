/**
 * spec-onboarding-candidate-identity.test.ts — MP-1 lane `L-4`, the POST-REPAIR suite.
 *
 * AUTHORITY: `R-798 §4`, which carries the fourteen obligations `A`–`N` VERBATIM into
 * the ledger. They are transcribed here one-for-one, in order, un-renumbered and
 * un-substituted. `COUNT OBLIGATIONS, NOT SENTENCES — NOTHING DETECTS A MISSING ROW.`
 *
 * WHAT HAPPENED TO THE `L-1` RED THAT USED TO LIVE IN THIS FILE
 * -------------------------------------------------------------
 * It is preserved, unedited, at commit `c51dcdb9` — its own commit, exactly so this
 * moment could not erase it. Two of its four arms could not survive `L-3` by design:
 *
 *   - `PRE-REPAIR WITNESS` asserted that candidates B and C are SWALLOWED as
 *     `skipped_duplicate`. That assertion IS the defect. A test that asserts a defect
 *     cannot outlive its repair, and its successors are obligations `F` and `G`, which
 *     assert the exact opposite and are the desk's own wording.
 *   - The fixture receipts carried 2 of the 5 keys `OPENING_RANGE_EXECUTION_CANDIDATE_
 *     RECEIPT/1` declares. `L-1` asserted NOTHING about receipt shape — measured: zero
 *     `expect(...)` on any receipt field — so those values were placeholders standing in
 *     for a label nobody yet inspected. Obligation `H` (new in `R-798`) inspects it now,
 *     so the fixtures are completed to what the Python authority actually requires.
 *
 *     🛑 That is a repair to an INPUT, not the relaxation of an ASSERTION. No obligation
 *     here is weaker than the desk wrote it, and `L-3` was not shaped to fit a fixture.
 *
 * THE HARNESS IS THE REAL SERVICE AGAINST A REAL DATABASE
 * -------------------------------------------------------
 * `onboardSpecArtifact` is imported from the production module and runs against PGlite,
 * a real in-process Postgres wired to Drizzle. The only `vi.mock` is the DB-CONNECTION
 * seam. `R-797 §6[1]` makes a mocked service a STOP, and `[test-replica]` records six
 * greens in this repo that survived DELETING production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../__tests__/helpers/pglite-db.js";
import type { TestDb } from "../../__tests__/helpers/pglite-db.js";

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
const RECEIPT_SCHEMA = "OPENING_RANGE_EXECUTION_CANDIDATE_RECEIPT/1";

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
 * A WELL-FORMED receipt — the five outer keys `opening_range_candidate_receipt.py`
 * declares in `_RECEIPT_KEYS`, and no others (it refuses unknown keys in both
 * directions, and so does the TypeScript mirror).
 *
 * 🛑 `payload` is deliberately opaque here. TypeScript checks that it is PRESENT and
 * never what is inside it: the definition, the taught variants and every duration are
 * Python's authority. A test that asserted payload internals would be asking this file
 * to certify a boundary it is forbidden to cross.
 */
function receiptFor(candidateId: string, cacheIdentity: string, parentSpecHash = SPEC_HASH) {
  return {
    schema: RECEIPT_SCHEMA,
    parent_spec_hash: parentSpecHash,
    candidate_id: candidateId,
    cache_identity: cacheIdentity,
    payload: { opaque_to_typescript: true },
  };
}

/**
 * The three taught candidates, as OPAQUE identities.
 *
 * 🛑 The ids encode NO trading semantics. `R-797 §6` forbids a timeframe-derived
 * candidate, and ids reading `..._5m` would invite the next reader to parse a duration
 * out of one. The variable NAMES carry the meaning; the VALUES carry none.
 */
const CANDIDATE_A = { candidateId: "orc_c1f4a9e2", cacheIdentity: "ci_7b21d0", receipt: receiptFor("orc_c1f4a9e2", "ci_7b21d0") };
const CANDIDATE_B = { candidateId: "orc_9d3e77b0", cacheIdentity: "ci_44ac81", receipt: receiptFor("orc_9d3e77b0", "ci_44ac81") };
const CANDIDATE_C = { candidateId: "orc_2a86bf51", cacheIdentity: "ci_e0195c", receipt: receiptFor("orc_2a86bf51", "ci_e0195c") };

/**
 * The three taught EXEC TIMEFRAMES, supplied EXPLICITLY on every single onboarding.
 *
 * 🛑 BINDING, `R-798` (from `AR-942 §2`'s own `L-2` finding): the PGlite DDL gives
 * `timeframe` a `DEFAULT '5m'` that production's `notNull`-with-no-default schema does
 * NOT have. `5m` is the one value this lane exists to distinguish, so a test that
 * omitted it would silently receive the answer it was trying to prove.
 *
 *   `A DEFAULT THE TEST SCHEMA HAS AND PRODUCTION LACKS IS NOT A CONSTRAINT DIFFERENCE
 *    — IT IS A TEST THAT CANNOT FAIL THE WAY PRODUCTION WOULD.`
 */
const TF_A = "5m";
const TF_B = "15m";
const TF_C = "30m";

describe("MP-1 L-4 — candidate identity survives production onboarding (obligations A–N)", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  // Fresh database PER TEST. Obligations disagree about the state they need (E and L
  // both start from "A already exists" but require opposite outcomes), and a shared DB
  // would make each one's verdict depend on the order the runner happened to pick.
  beforeEach(async () => {
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

  afterEach(async () => {
    await ctx.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** `symbol`, `timeframe` and `config` are ALWAYS supplied — never a DDL default. */
  const onboard = (candidate: unknown, timeframe: string) =>
    onboardSpecArtifact(openingRangeParentSpec(), {
      dryRun: false,
      symbols: [SYMBOL],
      timeframe,
      playbookRouterPath,
      skipDslCritic: true,
      ...(candidate === undefined ? {} : { executionCandidate: candidate as never }),
    });

  const statuses = (r: Awaited<ReturnType<typeof onboard>>) => r.perSymbol.map((p) => p.status);

  const rowsForThisSpec = async () => {
    const all = await ctx.db.select().from(strategies).where(eq(strategies.symbol, SYMBOL));
    return all.filter((r) => Array.isArray(r.tags) && r.tags.includes(`spec_hash:${SPEC_HASH}`));
  };

  const cfg = (row: { config: unknown }) => (row.config ?? {}) as Record<string, unknown>;

  /** The whole taught family, onboarded. Used by A–D and N. */
  const onboardAllThree = async () => {
    const a = await onboard(CANDIDATE_A, TF_A);
    const b = await onboard(CANDIDATE_B, TF_B);
    const c = await onboard(CANDIDATE_C, TF_C);
    return { a, b, c };
  };

  // ─── A ────────────────────────────────────────────────────────────────────
  it("A: 5m / 15m / 30m produce THREE persisted strategy rows", async () => {
    const { a, b, c } = await onboardAllThree();
    // POSITIVE WITNESS FIRST: all three calls actually reached the insert path. Without
    // it, "three rows exist" and "the harness silently did nothing three times" are the
    // same observation on an empty assertion.
    expect([statuses(a), statuses(b), statuses(c)]).toEqual([["inserted"], ["inserted"], ["inserted"]]);
    const rows = await rowsForThisSpec();
    expect(rows.length).toBe(3);
  });

  // ─── B ────────────────────────────────────────────────────────────────────
  it("B: all three rows share exactly ONE parent spec_hash", async () => {
    await onboardAllThree();
    const rows = await rowsForThisSpec();
    expect(rows.length).toBe(3);
    const parents = new Set(
      rows.map((r) => ((cfg(r)["compiled_spec"] as Record<string, unknown>)?.["spec_hash"] as string) ?? null),
    );
    expect([...parents]).toEqual([SPEC_HASH]);
  });

  // ─── C ────────────────────────────────────────────────────────────────────
  it("C: the three rows persist THREE distinct execution_candidate_id values", async () => {
    await onboardAllThree();
    const rows = await rowsForThisSpec();
    const ids = rows.map((r) => cfg(r)["execution_candidate_id"] as string);
    expect(ids.filter(Boolean).length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    expect([...ids].sort()).toEqual(
      [CANDIDATE_A.candidateId, CANDIDATE_B.candidateId, CANDIDATE_C.candidateId].sort(),
    );
  });

  // ─── D ────────────────────────────────────────────────────────────────────
  it("D: the three rows persist THREE distinct execution_candidate_cache_identity values", async () => {
    await onboardAllThree();
    const rows = await rowsForThisSpec();
    const cacheIds = rows.map((r) => cfg(r)["execution_candidate_cache_identity"] as string);
    expect(cacheIds.filter(Boolean).length).toBe(3);
    expect(new Set(cacheIds).size).toBe(3);
    expect([...cacheIds].sort()).toEqual(
      [CANDIDATE_A.cacheIdentity, CANDIDATE_B.cacheIdentity, CANDIDATE_C.cacheIdentity].sort(),
    );
  });

  // ─── E ────────────────────────────────────────────────────────────────────
  // THE ANTI-OVERSHOOT GUARD. Without it, "candidate-aware idempotency works" is
  // indistinguishable from "dedupe was switched off".
  it("E: replaying the exact SAME candidate produces skipped_duplicate for its existing row", async () => {
    const first = await onboard(CANDIDATE_A, TF_A);
    expect(statuses(first)).toEqual(["inserted"]);
    const replay = await onboard(CANDIDATE_A, TF_A);
    expect(statuses(replay)).toEqual(["skipped_duplicate"]);
    expect((await rowsForThisSpec()).length).toBe(1);
  });

  // ─── F ────────────────────────────────────────────────────────────────────
  it("F: an existing 5m candidate does NOT make the 15m candidate duplicate", async () => {
    expect(statuses(await onboard(CANDIDATE_A, TF_A))).toEqual(["inserted"]);
    expect(statuses(await onboard(CANDIDATE_B, TF_B))).toEqual(["inserted"]);
    expect((await rowsForThisSpec()).length).toBe(2);
  });

  // ─── G ────────────────────────────────────────────────────────────────────
  it("G: an existing 15m candidate does NOT make the 30m candidate duplicate", async () => {
    expect(statuses(await onboard(CANDIDATE_B, TF_B))).toEqual(["inserted"]);
    expect(statuses(await onboard(CANDIDATE_C, TF_C))).toEqual(["inserted"]);
    expect((await rowsForThisSpec()).length).toBe(2);
  });

  // ─── H ────────────────────────────────────────────────────────────────────
  it("H: candidate-aware onboarding with a MISSING execution-candidate receipt REFUSES", async () => {
    const noReceipt = { candidateId: "orc_c1f4a9e2", cacheIdentity: "ci_7b21d0", receipt: undefined };
    const res = await onboard(noReceipt, TF_A);
    expect(statuses(res)).toEqual(["refused_candidate_receipt"]);
    expect(res.ok).toBe(false);
    // A refusal that still wrote a row is not a refusal.
    expect((await rowsForThisSpec()).length).toBe(0);
  });

  // ─── I ────────────────────────────────────────────────────────────────────
  it("I: outer candidate ID disagreeing with the receipt REFUSES", async () => {
    const mismatched = {
      candidateId: "orc_c1f4a9e2",
      cacheIdentity: "ci_7b21d0",
      receipt: receiptFor("orc_SOMEONE_ELSE", "ci_7b21d0"),
    };
    const res = await onboard(mismatched, TF_A);
    expect(statuses(res)).toEqual(["refused_candidate_receipt"]);
    expect((await rowsForThisSpec()).length).toBe(0);
  });

  // ─── J ────────────────────────────────────────────────────────────────────
  it("J: outer cache identity disagreeing with the receipt REFUSES", async () => {
    const mismatched = {
      candidateId: "orc_c1f4a9e2",
      cacheIdentity: "ci_7b21d0",
      receipt: receiptFor("orc_c1f4a9e2", "ci_DIFFERENT_CONTENT"),
    };
    const res = await onboard(mismatched, TF_A);
    expect(statuses(res)).toEqual(["refused_candidate_receipt"]);
    expect((await rowsForThisSpec()).length).toBe(0);
  });

  // ─── K ────────────────────────────────────────────────────────────────────
  it("K: receipt parent/spec identity disagreeing with the parent spec_hash REFUSES", async () => {
    const foreignParent = {
      candidateId: "orc_c1f4a9e2",
      cacheIdentity: "ci_7b21d0",
      receipt: receiptFor("orc_c1f4a9e2", "ci_7b21d0", "hash_a_DIFFERENT_parent_spec"),
    };
    const res = await onboard(foreignParent, TF_A);
    expect(statuses(res)).toEqual(["refused_candidate_receipt"]);
    expect((await rowsForThisSpec()).length).toBe(0);
  });

  // ─── L ────────────────────────────────────────────────────────────────────
  /**
   * THE ONE TO GET RIGHT. Same `candidate_id`, changed `cache_identity` means the
   * system is claiming ONE candidate identity now carries DIFFERENT certified content.
   * That is PROVENANCE DRIFT. Insert would give one identity two rows; skip would
   * silently prefer the stored content. Only REFUSE is honest — and the test asserts
   * BOTH negatives, because "not inserted" alone is satisfied by a silent skip.
   */
  it("L: same candidate ID + changed cache identity REFUSES — neither inserts nor skips", async () => {
    expect(statuses(await onboard(CANDIDATE_A, TF_A))).toEqual(["inserted"]);

    const drifted = {
      candidateId: CANDIDATE_A.candidateId,
      cacheIdentity: "ci_RESTAMPED_CONTENT",
      receipt: receiptFor(CANDIDATE_A.candidateId, "ci_RESTAMPED_CONTENT"),
    };
    const res = await onboard(drifted, TF_A);

    expect(statuses(res)).toEqual(["refused_candidate_identity_conflict"]);
    expect(statuses(res)).not.toEqual(["skipped_duplicate"]);
    expect(statuses(res)).not.toEqual(["inserted"]);

    // It may NOT insert: exactly one row, still carrying the ORIGINAL content identity.
    const rows = await rowsForThisSpec();
    expect(rows.length).toBe(1);
    expect(cfg(rows[0])["execution_candidate_cache_identity"]).toBe(CANDIDATE_A.cacheIdentity);
  });

  // ─── M ────────────────────────────────────────────────────────────────────
  it("M: legacy receiptless onboarding retains its existing spec_hash + symbol idempotency", async () => {
    expect(statuses(await onboard(undefined, TF_A))).toEqual(["inserted"]);
    // Same spec_hash + symbol, DIFFERENT timeframe — under legacy rules still a
    // duplicate, exactly as before L-3. This is the arm that proves the repair did not
    // widen behaviour for callers that never opted in.
    expect(statuses(await onboard(undefined, TF_B))).toEqual(["skipped_duplicate"]);
    expect((await rowsForThisSpec()).length).toBe(1);
  });

  // ─── N ────────────────────────────────────────────────────────────────────
  /**
   * `N` is an ABSENCE claim, so each arm carries a positive witness that the path ran.
   * A row that was never written trivially "contains no invented candidate".
   */
  it("N: no candidate is selected or reconstructed from [0], array order, timeframe, name, or default duration", async () => {
    // (1) Legacy row RAN and persisted NO candidate fields — nothing is minted.
    expect(statuses(await onboard(undefined, TF_A))).toEqual(["inserted"]);
    const legacy = await rowsForThisSpec();
    expect(legacy.length).toBe(1); // witness: the path ran
    expect(cfg(legacy[0])["execution_candidate_id"]).toBeUndefined();
    expect(cfg(legacy[0])["execution_candidate_cache_identity"]).toBeUndefined();
    expect(cfg(legacy[0])["execution_candidate_receipt"]).toBeUndefined();
  });

  it("N: array ORDER does not decide identity — onboarding C, A, B yields the same three identities", async () => {
    // Reverse-ish order. If anything keyed on [0], arrival order or the timeframe
    // string, the identity set would differ from the A→B→C order asserted in C.
    expect(statuses(await onboard(CANDIDATE_C, TF_C))).toEqual(["inserted"]);
    expect(statuses(await onboard(CANDIDATE_A, TF_A))).toEqual(["inserted"]);
    expect(statuses(await onboard(CANDIDATE_B, TF_B))).toEqual(["inserted"]);

    const rows = await rowsForThisSpec();
    expect(rows.length).toBe(3);
    expect(rows.map((r) => cfg(r)["execution_candidate_id"] as string).sort()).toEqual(
      [CANDIDATE_A.candidateId, CANDIDATE_B.candidateId, CANDIDATE_C.candidateId].sort(),
    );
    // And no persisted identity is derivable from the timeframe it arrived with.
    for (const r of rows) {
      const id = cfg(r)["execution_candidate_id"] as string;
      expect(id).not.toContain(r.timeframe as string);
    }
  });
});
