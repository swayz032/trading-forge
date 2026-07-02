/**
 * provenance-stamp.integration.test.ts — Layer 4 research conveyor, item 3 (2026-07-02)
 *
 * Integration tests: provenance stamp hard gate round-tripped through a real
 * PGlite in-memory PostgreSQL database.
 *
 * WHAT EACH TEST DOES
 * -------------------
 * (a) Write WITHOUT stamp is refused when PROVENANCE_STAMP_ENFORCE=true (default).
 * (b) Write WITH valid stamp persists and round-trips correctly through the DB.
 * (c) Hash stability: same overlay config → same hash; changed config → changed hash.
 * (d) Legacy backfill path: missing stamp accepted ONLY behind PROVENANCE_ALLOW_LEGACY_BACKFILL=true.
 * (e) Audit row emitted on provenance refusal (unit-level: ProvenanceStampError is thrown).
 *
 * CONSTRAINTS:
 *   - DB-FREE imports for provenance-stamp.ts (no ../db/index.js transitive pull)
 *   - Uses pglite-db.ts helpers following gate-chain-integration.test.ts patterns exactly
 *   - UUID prefix bb00 to avoid test-ID collisions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createTestDb } from "./helpers/pglite-db.js";
import type { TestDb } from "./helpers/pglite-db.js";
import { backtests, strategies } from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  buildProvenanceStamp,
  buildLegacyProvenanceStamp,
  validateProvenanceStamp,
  assertProvenanceStamp,
  computeOverlayConfigHash,
  buildDataSnapshotId,
  ENGINE_VERSION,
  GATE_BATTERY_VERSION,
  ProvenanceStampError,
  deriveSpecProvenanceRef,
  isLegacyBackfillAllowed,
  isProvenanceEnforced,
  type ProvenanceStampOptions,
} from "../lib/provenance-stamp.js";

// ─── UUID namespace: bb00 prefix — no collision with other gate-chain suites ──
// Strategy UUIDs — one per suite (suites use isolated PGlite instances)
const STRAT_ID   = "bb000001-0000-0000-0000-000000000001"; // Suite A
const STRAT_ID_B = "bb000001-0000-0000-0000-000000000002"; // Suite B
const STRAT_ID_D = "bb000001-0000-0000-0000-000000000003"; // Suite D
// Backtest row UUIDs
const BT_STAMPED   = "bb000001-0000-0000-0000-000000000010"; // valid stamp → persists
const BT_LEGACY    = "bb000001-0000-0000-0000-000000000020"; // legacy stamp → persists (behind flag)
const BT_NO_STAMP  = "bb000001-0000-0000-0000-000000000030"; // null stamp → refused

// Default stamp opts for all tests
const DEFAULT_STAMP_OPTS: ProvenanceStampOptions = {
  symbol: "MES",
  timeframe: "5m",
  startDate: "2025-01-01",
  endDate: "2025-06-01",
  dataSource: "databento",
  specProvenanceRef: "youtube/abc123",
};

// ════════════════════════════════════════════════════════════════════════════════
// Suite A — Valid stamp persists and round-trips through PGlite
// ════════════════════════════════════════════════════════════════════════════════

describe("Provenance stamp — valid stamp DB round-trip (PGlite)", () => {
  let ctx: TestDb;

  beforeAll(async () => {
    ctx = await createTestDb();

    await ctx.db.insert(strategies).values({
      id: STRAT_ID,
      name: "provenance-test-strategy",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("inserts a row with a valid provenance stamp and reads it back intact", async () => {
    const stamp = buildProvenanceStamp(DEFAULT_STAMP_OPTS);
    const validated = assertProvenanceStamp(stamp, DEFAULT_STAMP_OPTS);

    // Assert stamp has all required fields before we even write
    expect(stamp.engine_version).toMatch(/^8\.\d+\.\d+/);
    expect(stamp.gate_battery_version).toBe(GATE_BATTERY_VERSION);
    expect(stamp.overlay_config_hash).toHaveLength(64); // SHA-256 hex
    expect(stamp.data_snapshot_id).toMatch(/^[a-f0-9]{64}::databento$/);
    expect(stamp.spec_provenance_ref).toBe("youtube/abc123");
    expect(stamp.stamped_at).toBeTruthy();
    expect(stamp.legacy).toBeUndefined(); // normal stamp has no legacy flag

    await ctx.db.insert(backtests).values({
      id: BT_STAMPED,
      strategyId: STRAT_ID,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      provenanceStamp: validated as unknown as Record<string, unknown>,
    });

    const [row] = await ctx.db
      .select()
      .from(backtests)
      .where(eq(backtests.id, BT_STAMPED));

    expect(row).toBeDefined();
    const ps = row!.provenanceStamp as Record<string, unknown>;
    expect(ps).toBeDefined();
    expect(ps["engine_version"]).toBe(stamp.engine_version);
    expect(ps["gate_battery_version"]).toBe(GATE_BATTERY_VERSION);
    expect(ps["overlay_config_hash"]).toHaveLength(64);
    expect(ps["data_snapshot_id"]).toMatch(/::databento$/);
    expect(ps["spec_provenance_ref"]).toBe("youtube/abc123");
  });

  it("validateProvenanceStamp returns ok:true for a complete stamp", () => {
    const stamp = buildProvenanceStamp(DEFAULT_STAMP_OPTS);
    const result = validateProvenanceStamp(stamp);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("validateProvenanceStamp returns ok:false when required fields are missing", () => {
    const incomplete = {
      engine_version: "8.1.0+abc",
      // missing data_snapshot_id, gate_battery_version, overlay_config_hash, spec_provenance_ref
    };
    const result = validateProvenanceStamp(incomplete);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("data_snapshot_id");
    expect(result.missing).toContain("gate_battery_version");
    expect(result.missing).toContain("overlay_config_hash");
    expect(result.missing).toContain("spec_provenance_ref");
  });

  it("validateProvenanceStamp rejects null stamp", () => {
    const result = validateProvenanceStamp(null);
    expect(result.ok).toBe(false);
    expect(result.missing).toHaveLength(5);
  });

  it("validateProvenanceStamp accepts legacy stamp regardless of field values", () => {
    const legacyStamp = buildLegacyProvenanceStamp({});
    const result = validateProvenanceStamp(legacyStamp);
    expect(result.ok).toBe(true); // legacy=true bypasses field validation
    expect(legacyStamp.legacy).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite B — Hard gate: write without stamp is refused
// ════════════════════════════════════════════════════════════════════════════════

describe("Provenance stamp — hard gate refusal (enforcement ON)", () => {
  let ctx: TestDb;
  let originalEnforceEnv: string | undefined;
  let originalLegacyEnv: string | undefined;

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID_B,
      name: "provenance-refusal-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    originalEnforceEnv = process.env["PROVENANCE_STAMP_ENFORCE"];
    originalLegacyEnv = process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"];
  });

  afterEach(() => {
    if (originalEnforceEnv === undefined) {
      delete process.env["PROVENANCE_STAMP_ENFORCE"];
    } else {
      process.env["PROVENANCE_STAMP_ENFORCE"] = originalEnforceEnv;
    }
    if (originalLegacyEnv === undefined) {
      delete process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"];
    } else {
      process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"] = originalLegacyEnv;
    }
  });

  it("assertProvenanceStamp throws ProvenanceStampError when stamp is null (enforcement ON)", () => {
    process.env["PROVENANCE_STAMP_ENFORCE"] = "true";
    delete process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"];

    expect(() => assertProvenanceStamp(null)).toThrowError(ProvenanceStampError);
    expect(() => assertProvenanceStamp(null)).toThrowError(/persistence refused/);
  });

  it("assertProvenanceStamp throws with correct missingFields array", () => {
    process.env["PROVENANCE_STAMP_ENFORCE"] = "true";

    const partialStamp = {
      engine_version: "8.1.0+abc",
      // missing 4 fields
      stamped_at: new Date().toISOString(),
      git_sha: "abc123",
    };

    let caughtErr: ProvenanceStampError | null = null;
    try {
      assertProvenanceStamp(partialStamp as never);
    } catch (err) {
      caughtErr = err as ProvenanceStampError;
    }

    expect(caughtErr).toBeInstanceOf(ProvenanceStampError);
    expect(caughtErr!.missingFields).toContain("data_snapshot_id");
    expect(caughtErr!.missingFields).toContain("gate_battery_version");
    expect(caughtErr!.missingFields).toContain("overlay_config_hash");
    expect(caughtErr!.missingFields).toContain("spec_provenance_ref");
  });

  it("isProvenanceEnforced() returns true by default (no env var set)", () => {
    delete process.env["PROVENANCE_STAMP_ENFORCE"];
    expect(isProvenanceEnforced()).toBe(true);
  });

  it("isProvenanceEnforced() returns false when PROVENANCE_STAMP_ENFORCE=false", () => {
    process.env["PROVENANCE_STAMP_ENFORCE"] = "false";
    expect(isProvenanceEnforced()).toBe(false);
  });

  it("assertProvenanceStamp passes null through when enforcement is OFF", () => {
    process.env["PROVENANCE_STAMP_ENFORCE"] = "false";
    // Should not throw — returns a legacy stamp as fallback
    const result = assertProvenanceStamp(null, DEFAULT_STAMP_OPTS);
    expect(result).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite C — Hash stability: same config → same hash; changed config → changed hash
// ════════════════════════════════════════════════════════════════════════════════

describe("Provenance stamp — hash stability (overlay_config_hash)", () => {
  let originalEnvVars: Record<string, string | undefined> = {};

  const TRACKED_VARS = [
    "BACKTEST_STATIC_C_PARTIALS_ENABLED",
    "BACKTEST_PARTIAL_FILL_ENABLED",
    "BACKTEST_COMPLIANCE_MODE",
    "BACKTEST_ROLL_SPREAD_ITEMIZED",
    "BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD",
    "STOP_CEILING_PTS_MES",
    "STOP_CEILING_PTS_MNQ",
    "STOP_CEILING_PTS_MCL",
    "STOP_FLOOR_ATR_MULT",
  ];

  beforeEach(() => {
    // Snapshot all tracked env vars before each test
    for (const key of TRACKED_VARS) {
      originalEnvVars[key] = process.env[key];
    }
  });

  afterEach(() => {
    // Restore all tracked env vars after each test
    for (const key of TRACKED_VARS) {
      if (originalEnvVars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnvVars[key];
      }
    }
    originalEnvVars = {};
  });

  it("same env config produces identical overlay_config_hash on repeated calls", () => {
    // Clear all tracked vars to get the pure-default hash
    for (const key of TRACKED_VARS) {
      delete process.env[key];
    }

    const hash1 = computeOverlayConfigHash();
    const hash2 = computeOverlayConfigHash();
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it("turning off BACKTEST_STATIC_C_PARTIALS_ENABLED produces a different hash", () => {
    for (const key of TRACKED_VARS) {
      delete process.env[key];
    }

    const hashDefault = computeOverlayConfigHash(); // partials=true (default)

    process.env["BACKTEST_STATIC_C_PARTIALS_ENABLED"] = "0"; // partials=false
    const hashOff = computeOverlayConfigHash();

    expect(hashDefault).not.toBe(hashOff);
    expect(hashOff).toHaveLength(64);
  });

  it("changing compliance_mode produces a different hash", () => {
    for (const key of TRACKED_VARS) {
      delete process.env[key];
    }

    const hashEnforce = computeOverlayConfigHash(); // default: enforce

    process.env["BACKTEST_COMPLIANCE_MODE"] = "shadow";
    const hashShadow = computeOverlayConfigHash();

    expect(hashEnforce).not.toBe(hashShadow);
  });

  it("changing stop ceiling changes the hash", () => {
    for (const key of TRACKED_VARS) {
      delete process.env[key];
    }

    const hash14pt = computeOverlayConfigHash(); // default: 14pt MES

    process.env["STOP_CEILING_PTS_MES"] = "12"; // changed
    const hash12pt = computeOverlayConfigHash();

    expect(hash14pt).not.toBe(hash12pt);
  });

  it("buildDataSnapshotId is stable for same inputs", () => {
    const id1 = buildDataSnapshotId("MES", "5m", "2025-01-01", "2025-06-01");
    const id2 = buildDataSnapshotId("MES", "5m", "2025-01-01", "2025-06-01");
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{64}::databento$/);
  });

  it("buildDataSnapshotId changes with different symbol", () => {
    const mes = buildDataSnapshotId("MES", "5m", "2025-01-01", "2025-06-01");
    const mnq = buildDataSnapshotId("MNQ", "5m", "2025-01-01", "2025-06-01");
    expect(mes).not.toBe(mnq);
  });

  it("buildDataSnapshotId changes with different source tag", () => {
    const databento = buildDataSnapshotId("MES", "5m", "2025-01-01", "2025-06-01", "databento");
    const csv = buildDataSnapshotId("MES", "5m", "2025-01-01", "2025-06-01", "csv");
    expect(databento).not.toBe(csv);
  });

  it("ENGINE_VERSION and GATE_BATTERY_VERSION are non-empty constants", () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(GATE_BATTERY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("buildProvenanceStamp produces deterministic stamp for same env", () => {
    for (const key of TRACKED_VARS) {
      delete process.env[key];
    }
    delete process.env["FORGE_GIT_SHA"];

    const stamp1 = buildProvenanceStamp(DEFAULT_STAMP_OPTS);
    const stamp2 = buildProvenanceStamp(DEFAULT_STAMP_OPTS);

    // All fields except stamped_at are deterministic
    expect(stamp1.engine_version).toBe(stamp2.engine_version);
    expect(stamp1.data_snapshot_id).toBe(stamp2.data_snapshot_id);
    expect(stamp1.gate_battery_version).toBe(stamp2.gate_battery_version);
    expect(stamp1.overlay_config_hash).toBe(stamp2.overlay_config_hash);
    expect(stamp1.spec_provenance_ref).toBe(stamp2.spec_provenance_ref);
    expect(stamp1.git_sha).toBe(stamp2.git_sha);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite D — Legacy backfill: works ONLY behind PROVENANCE_ALLOW_LEGACY_BACKFILL=true
// ════════════════════════════════════════════════════════════════════════════════

describe("Provenance stamp — legacy backfill path (PROVENANCE_ALLOW_LEGACY_BACKFILL)", () => {
  let ctx: TestDb;
  let originalLegacyEnv: string | undefined;
  let originalEnforceEnv: string | undefined;

  beforeAll(async () => {
    ctx = await createTestDb();
    await ctx.db.insert(strategies).values({
      id: STRAT_ID_D,
      name: "provenance-legacy-test",
      symbol: "MES",
      timeframe: "5m",
      config: {},
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    originalLegacyEnv = process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"];
    originalEnforceEnv = process.env["PROVENANCE_STAMP_ENFORCE"];
  });

  afterEach(() => {
    if (originalLegacyEnv === undefined) {
      delete process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"];
    } else {
      process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"] = originalLegacyEnv;
    }
    if (originalEnforceEnv === undefined) {
      delete process.env["PROVENANCE_STAMP_ENFORCE"];
    } else {
      process.env["PROVENANCE_STAMP_ENFORCE"] = originalEnforceEnv;
    }
  });

  it("isLegacyBackfillAllowed() returns false by default", () => {
    delete process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"];
    expect(isLegacyBackfillAllowed()).toBe(false);
  });

  it("isLegacyBackfillAllowed() returns true when env=true", () => {
    process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"] = "true";
    expect(isLegacyBackfillAllowed()).toBe(true);
  });

  it("assertProvenanceStamp throws when stamp=null and legacy backfill is OFF", () => {
    process.env["PROVENANCE_STAMP_ENFORCE"] = "true";
    delete process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"];

    expect(() => assertProvenanceStamp(null)).toThrowError(ProvenanceStampError);
  });

  it("assertProvenanceStamp returns legacy stamp when stamp=null and legacy backfill is ON", () => {
    process.env["PROVENANCE_STAMP_ENFORCE"] = "true";
    process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"] = "true";

    const result = assertProvenanceStamp(null, DEFAULT_STAMP_OPTS);
    expect(result).toBeDefined();
    expect(result.legacy).toBe(true);
    expect(result.engine_version).toMatch(/^legacy\+/);
    expect(result.gate_battery_version).toBe("legacy");
    expect(result.overlay_config_hash).toBe("legacy");
    // data_snapshot_id is computed from opts when available
    expect(result.data_snapshot_id).toMatch(/::databento$/);
  });

  it("legacy stamp persists and round-trips through PGlite", async () => {
    process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"] = "true";

    const legacyStamp = buildLegacyProvenanceStamp(DEFAULT_STAMP_OPTS);
    expect(legacyStamp.legacy).toBe(true);

    await ctx.db.insert(backtests).values({
      id: BT_LEGACY,
      strategyId: STRAT_ID_D,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      provenanceStamp: legacyStamp as unknown as Record<string, unknown>,
    });

    const [row] = await ctx.db
      .select()
      .from(backtests)
      .where(eq(backtests.id, BT_LEGACY));

    expect(row).toBeDefined();
    const ps = row!.provenanceStamp as Record<string, unknown>;
    expect(ps["legacy"]).toBe(true);
    expect(ps["engine_version"]).toMatch(/^legacy\+/);
    expect(ps["gate_battery_version"]).toBe("legacy");
    expect(ps["overlay_config_hash"]).toBe("legacy");
  });

  it("rows with null provenance_stamp persist (null allowed by DB for pre-stamp rows)", async () => {
    // The DB accepts null (existing rows have null before backfill).
    // The HARD GATE is in the service layer (assertProvenanceStamp), not the DB.
    await ctx.db.insert(backtests).values({
      id: BT_NO_STAMP,
      strategyId: STRAT_ID_D,
      symbol: "MES",
      timeframe: "5m",
      startDate: new Date("2025-01-01"),
      endDate: new Date("2025-06-01"),
      status: "completed",
      // No provenanceStamp — simulates pre-2026-07-02 row
    });

    const [row] = await ctx.db
      .select()
      .from(backtests)
      .where(eq(backtests.id, BT_NO_STAMP));

    expect(row).toBeDefined();
    // null is acceptable at DB level — the gate lives in the service
    expect(row!.provenanceStamp).toBeNull();
  });

  it("buildLegacyProvenanceStamp builds sentinel-only stamp when no opts provided", () => {
    const stamp = buildLegacyProvenanceStamp({});
    expect(stamp.legacy).toBe(true);
    expect(stamp.engine_version).toMatch(/^legacy\+/);
    expect(stamp.data_snapshot_id).toBe("legacy");
    expect(stamp.gate_battery_version).toBe("legacy");
    expect(stamp.overlay_config_hash).toBe("legacy");
    expect(stamp.spec_provenance_ref).toBe("legacy");
  });

  it("validateProvenanceStamp accepts a legacy stamp (legacy=true bypasses field check)", () => {
    process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"] = "true";
    const legacyStamp = buildLegacyProvenanceStamp({});
    const result = validateProvenanceStamp(legacyStamp);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Suite E — deriveSpecProvenanceRef helper
// ════════════════════════════════════════════════════════════════════════════════

describe("deriveSpecProvenanceRef — config path derivation", () => {
  it("extracts extraction_provenance from config.strategy.metadata", () => {
    const config = {
      strategy: {
        metadata: {
          extraction_provenance: "youtube/xK9mZ3pQabc",
        },
      },
    };
    expect(deriveSpecProvenanceRef(config)).toBe("youtube/xK9mZ3pQabc");
  });

  it("falls back to source_url when extraction_provenance absent", () => {
    const config = {
      strategy: {
        metadata: {
          source_url: "https://www.youtube.com/watch?v=abc123",
        },
      },
    };
    expect(deriveSpecProvenanceRef(config)).toBe("https://www.youtube.com/watch?v=abc123");
  });

  it("falls back to source when source_url absent and source is not manual/openclaw", () => {
    const config = {
      strategy: {
        metadata: {
          source: "reddit/FuturesTrading/some-post",
        },
      },
    };
    expect(deriveSpecProvenanceRef(config)).toBe("reddit/FuturesTrading/some-post");
  });

  it("returns 'none' for manual strategy (source=manual)", () => {
    const config = {
      strategy: {
        metadata: {
          source: "manual",
        },
      },
    };
    expect(deriveSpecProvenanceRef(config)).toBe("none");
  });

  it("returns 'none' for openclaw strategy", () => {
    const config = {
      strategy: {
        metadata: {
          source: "openclaw",
        },
      },
    };
    expect(deriveSpecProvenanceRef(config)).toBe("none");
  });

  it("returns 'none' when no provenance fields exist", () => {
    const config = { strategy: { metadata: {} } };
    expect(deriveSpecProvenanceRef(config)).toBe("none");
  });

  it("returns 'none' for empty config", () => {
    expect(deriveSpecProvenanceRef({})).toBe("none");
  });
});
