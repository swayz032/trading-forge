/**
 * spec-onboarding-timeframe.test.ts — Timeframe Integrity Fix (2026-07-03)
 *
 * The forward fix: onboarding no longer silently defaults a timeframe to "5m".
 * Covers:
 *   1. FAIL-LOUD — a spec with NO recoverable timeframe (and no operator
 *      override) is QUARANTINED: onboardSpecArtifact returns ok:false, writes a
 *      `onboard.timeframe_unrecoverable` audit, and inserts NO strategies row.
 *   2. RECOVERED — a spec whose prose states the timeframe is onboarded at the
 *      RECOVERED exec (never 5m): timeframe + trigger_tf + htf_tf columns set,
 *      name suffixed with the real TF, config.metadata.timeframe_recovery stamped.
 *   3. OVERRIDE — an explicit opts.timeframe bypasses recovery (known-uniform batch).
 *
 * DB injection mirrors spec-onboarding-service.test.ts (pglite + vi.mock).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
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
import { strategies, auditLog } from "../../db/schema.js";

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

// order_block-mappable spec whose prose STATES 15m exec + 4h context.
function orderBlock15mSpec() {
  return {
    video: "tfVid15m",
    spec_hash: "hash_tf_15m",
    graph_canonical_hash: "g15m",
    ledger_d: "CONSERVED",
    transcript_chars: 5000,
    spec: {
      direction: "long",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "order block on the 15 minute time frame", role: "trigger", span: { start: 0, end: 10 }, evidence: "e1" },
        { id: "C1", type: "WAIT_SESSION", object: "4 hour time frame bias", role: "confluence", span: { start: 10, end: 20 }, evidence: "e2" },
        { id: "C2", type: "WAIT_BIAS", object: "killzone timing", role: "confluence", span: { start: 20, end: 30 }, evidence: "e3" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
    },
  };
}

// A spec with NO recoverable timeframe (VWAP anchors only — no chart TF token).
function noTimeframeSpec() {
  return {
    video: "tfVidNone",
    spec_hash: "hash_tf_none",
    graph_canonical_hash: "gnone",
    ledger_d: "CONSERVED",
    transcript_chars: 4000,
    spec: {
      direction: "short",
      entry_conditions: [
        { id: "T1", type: "ENABLE_ENTRY", object: "vwap slope reversal cross", role: "trigger", span: { start: 0, end: 10 }, evidence: "e1" },
        { id: "C1", type: "WAIT_STRUCTURE", object: "daily vwap anchor", role: "confluence", span: { start: 10, end: 20 }, evidence: "e2" },
      ],
      and_groups: [],
      or_branches: [],
      invalidations: [],
      entry_trigger_id: "T1",
    },
  };
}

describe("spec-onboarding-service — timeframe integrity (fail-loud, no silent 5m)", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;
    await ctx.pg.exec(NEEDS_ARCHETYPE_QUEUE_DDL);
    // The shared pglite audit_log DDL declares `id UUID PRIMARY KEY` with no
    // default (production supplies gen_random_uuid via migration); insertAuditRowSafe
    // relies on the column default. Set it here so the fail-loud audit lands.
    await ctx.pg.exec("ALTER TABLE audit_log ALTER COLUMN id SET DEFAULT gen_random_uuid();");

    tmpDir = mkdtempSync(join(tmpdir(), "playbook-router-tf-test-"));
    playbookRouterPath = join(tmpDir, "playbook_router_fixture.py");
    writeFileSync(
      playbookRouterPath,
      [
        'CONTINUATION_STRATS = ["ote", "ict_swing"]',
        'REVERSAL_STRATS = ["breaker"]',
        'MEAN_REV_STRATS = ["midnight_open"]',
        'ORB_STRATS = ["iofed"]',
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

  it("FAIL-LOUD: no recoverable timeframe → quarantine (audit + NO 5m row inserted)", async () => {
    const result = await onboardSpecArtifact(noTimeframeSpec(), {
      dryRun: false,
      // NO explicit timeframe — must recover per-spec; here it cannot.
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^timeframe_unrecoverable/);
    expect(result.perSymbol).toEqual([]);

    // NO strategies row was inserted for this spec (never a guessed-5m row).
    const rows = await ctx.db
      .select()
      .from(strategies)
      .where(eq(strategies.source, "spec_onboarding"));
    expect(rows.find((r) => (r.tags ?? []).includes("spec_hash:hash_tf_none"))).toBeUndefined();

    // A loud audit row was written.
    const audits = await ctx.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "onboard.timeframe_unrecoverable"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("RECOVERED: onboards at the educator's exec TF (15m), sets trigger_tf/htf_tf, fixes name suffix", async () => {
    const result = await onboardSpecArtifact(orderBlock15mSpec(), {
      dryRun: false,
      // NO explicit timeframe — recovered from spec prose.
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(true);
    for (const p of result.perSymbol) {
      expect(p.status).toBe("inserted");
      expect(p.strategyName).toMatch(/_15m$/); // NOT _5m
    }

    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mes.strategyId!));
    expect(row.timeframe).toBe("15m");
    expect(row.triggerTf).toBe("15m");
    expect(row.htfTf).toBe("4h");

    const config = row.config as Record<string, unknown>;
    const stratBlock = config.strategy as Record<string, unknown>;
    expect(stratBlock.timeframe).toBe("15m");
    expect(stratBlock.trigger_tf).toBe("15m");
    expect(stratBlock.htf_tf).toBe("4h");
    const meta = config.metadata as Record<string, unknown>;
    const recovery = meta.timeframe_recovery as Record<string, unknown>;
    expect(recovery.source).toBe("recovered_from_spec");
    expect(recovery.exec_timeframe).toBe("15m");
    expect(recovery.higher_timeframe).toBe("4h");
  });

  it("OVERRIDE: explicit opts.timeframe bypasses recovery even on an unrecoverable spec", async () => {
    const result = await onboardSpecArtifact(noTimeframeSpec(), {
      dryRun: false,
      timeframe: "30m", // operator override for a known-uniform batch
      playbookRouterPath,
      skipDslCritic: true,
    });

    expect(result.ok).toBe(true);
    for (const p of result.perSymbol) {
      expect(p.status).toBe("inserted");
      expect(p.strategyName).toMatch(/_30m$/);
    }
    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db
      .select()
      .from(strategies)
      .where(and(eq(strategies.id, mes.strategyId!)));
    expect(row.timeframe).toBe("30m");
    const meta = (row.config as Record<string, unknown>).metadata as Record<string, unknown>;
    expect((meta.timeframe_recovery as Record<string, unknown>).source).toBe("operator_override");
  });
});
