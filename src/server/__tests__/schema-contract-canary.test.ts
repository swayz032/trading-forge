/**
 * Schema contract canary (goalscan-r2, 2026-07-17 — Fable advisor ruling:
 * "no data-path component enters a graded run on mock-only coverage; every
 * reader gets a live-schema contract test").
 *
 * THE CLASS (three documented instances):
 *   1. backtester reader drift (historical).
 *   2. quantum_rl_agent._load_production_state_at() SELECTing bias_state columns
 *      {state, confluence_score, institutional_regime} that exist in NO
 *      migration — its unit tests passed because they MOCK the psycopg2 cursor,
 *      so the imagined schema was never checked against the real one.
 *   3. Live prod DB missing journal-applied migrations' DDL (0134/0007/0118) —
 *      caught by the RUNTIME canary (schema-drift-check.ts boot hook), not this
 *      test; this test guards the code-vs-declared-schema half of the class.
 *
 * WHAT THIS TEST DOES (pure static contract — no DB, no mocks):
 *   Parses the actual SQL text embedded in known data-path readers/writers and
 *   asserts every referenced bias_state column exists in schema.ts (the Drizzle
 *   source of truth that migrations implement).
 *
 * KNOWN_READER_DRIFT is the explicit ledger of the one already-diagnosed
 * offender, owned by the RL Path-A ratify packet (reader must be rewritten to
 * regime_label/regime_evidence as part of making RL regime-conditioned training
 * real). Shrinking that ledger to empty is a Path-A acceptance criterion.
 * ANY column not in schema.ts and not in the ledger fails this test — new
 * drift cannot land silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
// NOTE: import schema directly (NOT via schema-drift-check.ts) so this test
// stays free of the db/index.js bootstrap (no DATABASE_URL requirement).
import * as schema from "../db/schema.js";

const REPO_ROOT = resolve(__dirname, "../../..");

function declaredColumns(tableName: string): Set<string> {
  for (const exported of Object.values(schema)) {
    if (!(exported instanceof PgTable)) continue;
    const cfg = getTableConfig(exported as PgTable);
    if (cfg.name === tableName) return new Set(cfg.columns.map((c) => c.name));
  }
  throw new Error(`table ${tableName} not found in schema.ts`);
}

/**
 * The diagnosed offender: _load_production_state_at()'s bias_state SELECT.
 * Owner: RL Path-A ratify packet (reader rewrite to regime_label +
 * regime_evidence). Every entry here is a KNOWN, OPERATOR-SURFACED defect —
 * never add to this ledger to make a new test failure go away; fix the reader.
 */
const KNOWN_READER_DRIFT = new Set(["state", "confluence_score", "institutional_regime"]);

describe("schema contract canary — bias_state readers/writers vs schema.ts", () => {
  const biasStateCols = declaredColumns("bias_state");

  it("bias-state-service.ts INSERT column list exists in schema.ts (the 0134-class writer contract)", () => {
    const src = readFileSync(
      resolve(REPO_ROOT, "src/server/services/bias-state-service.ts"),
      "utf8",
    );
    const m = src.match(/INSERT INTO bias_state \(([^)]+)\)/);
    expect(m, "expected the bias_state INSERT statement to be present").toBeTruthy();
    const insertCols = m![1].split(",").map((c) => c.trim());
    expect(insertCols.length).toBeGreaterThanOrEqual(10);
    for (const col of insertCols) {
      expect(
        biasStateCols.has(col),
        `bias-state-service INSERT names "${col}" which schema.ts's bias_state does not declare — ` +
          `this is the exact defect class that silently killed bias_state persistence for 2 months`,
      ).toBe(true);
    }
  });

  it("quantum_rl_agent._load_production_state_at bias_state SELECT has no NEW drift beyond the Path-A ledger", () => {
    const src = readFileSync(resolve(REPO_ROOT, "src/engine/quantum_rl_agent.py"), "utf8");
    // The reader's SQL literal: SELECT <cols> FROM bias_state
    const m = src.match(/SELECT\s+([\s\S]*?)\s+FROM bias_state/);
    expect(m, "expected _load_production_state_at's bias_state SELECT to be present").toBeTruthy();
    const selectCols = m![1]
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0 && !c.startsWith("--"));
    expect(selectCols.length).toBeGreaterThanOrEqual(5);

    const newDrift: string[] = [];
    for (const col of selectCols) {
      if (!biasStateCols.has(col) && !KNOWN_READER_DRIFT.has(col)) newDrift.push(col);
    }
    expect(
      newDrift,
      `NEW schema drift in _load_production_state_at (not in schema.ts, not in the Path-A ledger): ${newDrift.join(", ")}`,
    ).toEqual([]);
  });

  it("Path-A ledger is still accurate — entries drop out as the reader gets fixed (packet acceptance criterion)", () => {
    const src = readFileSync(resolve(REPO_ROOT, "src/engine/quantum_rl_agent.py"), "utf8");
    const m = src.match(/SELECT\s+([\s\S]*?)\s+FROM bias_state/);
    const selectCols = new Set(
      m![1].split(",").map((c) => c.trim()).filter((c) => c.length > 0),
    );
    for (const ledgered of KNOWN_READER_DRIFT) {
      // If the reader no longer queries a ledgered column, the ledger entry is
      // stale — remove it so the canary tightens as Path-A lands.
      expect(
        selectCols.has(ledgered),
        `KNOWN_READER_DRIFT entry "${ledgered}" is no longer queried by the reader — remove it from the ledger (canary must tighten)`,
      ).toBe(true);
    }
  });
});
