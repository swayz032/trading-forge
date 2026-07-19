/**
 * spec-onboarding-exit-provenance.test.ts — F-3 (R-039 pin c / R-046 §4).
 *
 * Locks the house-default-exit PROVENANCE propagation the Python spec_producer
 * stamps (`spec.framework_overlay.exit = "house-default (trader taught none)"`
 * when the trader taught NO exit): onboardSpecArtifact must thread it into BOTH
 * config.metadata.exit_provenance AND config.compiled_spec.exit_provenance, and
 * must NOT stamp it when no house-default overlay is present. This is the test
 * deferred in AR-037 (vitest toolchain was in the @vitest/utils-missing wipe
 * state; repaired via `npm install` before this file was added).
 *
 * Same pglite bootstrap as spec-onboarding-service.bandc.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const HOUSE_DEFAULT_EXIT = "house-default (trader taught none)";

// A bindable spec (WAIT_SESSION with a recognized keyword clears the Band C
// binding-plan threshold), optionally carrying the house-default-exit overlay.
function compilableSpec(specHash: string, video: string, houseDefaultExit: boolean): unknown {
  const body: Record<string, unknown> = {
    direction: "long",
    entry_conditions: [
      { id: "T1", type: "ENABLE_ENTRY", object: "buying opportunity", role: "trigger", span: { start: 0, end: 10 }, evidence: "T-ep-001" },
      { id: "S1", type: "WAIT_SESSION", object: "ny am session", role: "spine", span: { start: 10, end: 20 }, evidence: "T-ep-002" },
      { id: "C1", type: "FILTER", object: "general market tone", role: "confluence", span: { start: 30, end: 40 }, evidence: "T-ep-004" },
    ],
    and_groups: [],
    or_branches: [],
    invalidations: [
      { id: "I1", type: "INVALIDATE", object: "structural break below level", role: "invalidation", span: { start: 20, end: 30 }, evidence: "T-ep-003" },
    ],
    entry_trigger_id: "T1",
  };
  if (houseDefaultExit) {
    body.framework_overlay = { exit: HOUSE_DEFAULT_EXIT, exit_source: "framework_overlay_style_c" };
  }
  return { video, spec_hash: specHash, graph_canonical_hash: "g_ep", ledger_d: "UNKNOWN", transcript_chars: 1000, spec: body };
}

describe("spec-onboarding — house-default-exit provenance propagation (F-3)", () => {
  let ctx: TestDb;
  let playbookRouterPath: string;
  let tmpDir: string;

  beforeAll(async () => {
    ctx = await createTestDb();
    injectedDb = ctx.db;
    await ctx.pg.exec(NEEDS_ARCHETYPE_QUEUE_DDL);
    tmpDir = mkdtempSync(join(tmpdir(), "exit-prov-test-"));
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

  it("propagates exit_provenance into config.metadata AND compiled_spec when the house-default stamp is present", async () => {
    const result = await onboardSpecArtifact(compilableSpec("hash_ep_yes", "epVidYes", true), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(result.ok).toBe(true);
    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mes.strategyId!));
    const config = row.config as Record<string, unknown>;

    const meta = config.metadata as Record<string, unknown>;
    expect(meta.exit_provenance).toBeDefined();
    expect((meta.exit_provenance as Record<string, unknown>).exit).toBe(HOUSE_DEFAULT_EXIT);

    const compiled = config.compiled_spec as Record<string, unknown>;
    expect(compiled.exit_provenance).toBeDefined();
    expect((compiled.exit_provenance as Record<string, unknown>).exit).toBe(HOUSE_DEFAULT_EXIT);
  });

  it("does NOT stamp exit_provenance when no house-default overlay (trader taught an exit)", async () => {
    const result = await onboardSpecArtifact(compilableSpec("hash_ep_no", "epVidNo", false), {
      dryRun: false,
      timeframe: "5m",
      playbookRouterPath,
      skipDslCritic: true,
    });
    expect(result.ok).toBe(true);
    const mes = result.perSymbol.find((p) => p.symbol === "MES")!;
    const [row] = await ctx.db.select().from(strategies).where(eq(strategies.id, mes.strategyId!));
    const config = row.config as Record<string, unknown>;

    expect((config.metadata as Record<string, unknown>).exit_provenance).toBeUndefined();
    expect((config.compiled_spec as Record<string, unknown>).exit_provenance).toBeUndefined();
  });
});
