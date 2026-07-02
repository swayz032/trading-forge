/**
 * provenance-stamp.ts — Layer 4 research conveyor, item 3 (2026-07-02)
 *
 * Builds and validates the provenance stamp attached to every persisted backtest row.
 * The stamp captures the five fields that make a backtest result reproducible and
 * comparable across time:
 *
 *   engine_version       — version of this codebase + git SHA at run time
 *   data_snapshot_id     — structural hash of the data slice (symbol/TF/date range)
 *   gate_battery_version — versioned constant co-located with the gate-chain code
 *   overlay_config_hash  — SHA-256 of the effective framework overlay config
 *   spec_provenance_ref  — compiled-spec identifier linking to the extraction chain
 *
 * Hard gate: persistence refuses writes missing any stamp field.
 *   - PROVENANCE_STAMP_ENFORCE=true (default) → throw ProvenanceStampError
 *   - PROVENANCE_ALLOW_LEGACY_BACKFILL=true → replace missing fields with
 *     "legacy" sentinel values, mark stamp.legacy=true (backfill only)
 *
 * Why overlay_config_hash matters:
 *   deepscan8 (2026-07-02) flipped BACKTEST_STATIC_C_PARTIALS_ENABLED default from
 *   OFF → ON, making ALL prior backtest results NOT directly comparable. The hash
 *   makes this regime change visible on every row: a hash change = results differ.
 *
 * Design constraints:
 *   - DB-FREE module (no import from ../db/index.js) — safe for tests
 *   - Deterministic: same inputs always produce the same stamp
 *   - Reuses SHA-256 + sorted-key canonical JSON from frozen-policy-hash.ts
 */

import { createHash } from "node:crypto";
import { computeDataHash } from "./result-hasher.js";

// ─── Version constants ────────────────────────────────────────────────────────

/**
 * ENGINE_VERSION — bump this when execution logic changes in a way that makes
 * prior backtest results non-comparable (fill model changes, stop logic, P&L
 * computation changes, etc.). Follows: <major>.<minor>.<patch>
 *
 * WHEN TO BUMP:
 *   - Any change to backtester.py fill/stop/TP logic
 *   - Any change to framework-overlay.ts canonical framework defaults
 *   - Any migration that changes how backtest results are computed or recorded
 *   - A new WF or MC methodology that changes the gate outputs
 *
 * VERSIONING HISTORY:
 *   8.0.x  — Wave 27.5 Pass C (partial fills ON, compliance enforce ON)
 *   8.1.0  — deepscan8 (StyleC partials default ON, BIF gate, T→P gates, envelope allowlist)
 */
export const ENGINE_VERSION = "8.1.0";

/**
 * GATE_BATTERY_VERSION — bump this when the set of promotion gates changes, or
 * when gate thresholds change (B14 ci_high 0.40→0.20, WFE 0.50→0.70, etc.).
 * Format: YYYY-MM-DD.<sequence> so bumps are self-documenting.
 *
 * WHEN TO BUMP:
 *   - Any new HARD gate added or removed from the promotion chain
 *   - Any gate threshold change (even tightening) that makes old results
 *     grade differently under the new battery
 *   - Any new gate-chain migration (new column read by lifecycle-service.ts)
 *
 * HISTORY:
 *   2026-05-25.1 — Wave 27.5 Pass B (WFE + B14 ci_high + parameter drift gates live)
 *   2026-06-22.1 — B14 tightened 0.40→0.20; WFE band [0.50-0.70) now BLOCKS
 *   2026-07-02.1 — deepscan8: T→P gates, BIF gate, StyleC partials default ON
 */
export const GATE_BATTERY_VERSION = "2026-07-02.1";

// ─── Canonical-sort helpers (mirrors frozen-policy-hash.ts) ──────────────────

function sortedKeyReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, sortedKeyReplacer);
}

// ─── Overlay config hash ──────────────────────────────────────────────────────

/**
 * EffectiveOverlayConfig — the env-controlled framework parameters that affect
 * P&L comparability. Any change to these makes prior backtest results non-comparable.
 *
 * These are READ from process.env at stamp-build time (not module load time)
 * so the hash reflects the config that was actually active during the backtest run.
 */
interface EffectiveOverlayConfig {
  // deepscan8: flipped default ON (2026-07-02) — the primary reason this module exists
  static_c_partials_enabled: boolean;
  // Wave 27.5 Pass C default — partial fill modeling
  partial_fill_enabled: boolean;
  // Wave 27.5 Pass C default — compliance gate mode
  compliance_mode: string;
  // Wave 27.5 Pass D default — roll spread itemized deduction
  roll_spread_itemized: boolean;
  // Wave 27.5 Pass D default — zero-volume trade critical fail loud
  zero_volume_trade_critical_fail_loud: boolean;
  // Framework overlay stop ceiling values per symbol (CLAUDE.md §4)
  stop_ceiling_pts_mes: number;
  stop_ceiling_pts_mnq: number;
  stop_ceiling_pts_mcl: number;
  // Framework overlay stop floor ATR multiplier
  stop_floor_atr_mult: number;
  // Style C canonical TP ratios — hard-coded constants but included for future-proofing
  style_c_tp1_pct: number;
  style_c_tp2_pct: number;
  style_c_runner_pct: number;
}

function envBool(key: string, defaultVal: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return defaultVal;
  return !["0", "false", "no"].includes(raw.toLowerCase());
}

function envFloat(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultVal;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : defaultVal;
}

function captureEffectiveOverlayConfig(): EffectiveOverlayConfig {
  return {
    // deepscan8 flipped this ON (default "1" = enabled).
    // "0"/"false"/"no" = disabled; anything else = enabled
    static_c_partials_enabled: envBool("BACKTEST_STATIC_C_PARTIALS_ENABLED", true),
    partial_fill_enabled: envBool("BACKTEST_PARTIAL_FILL_ENABLED", true),
    compliance_mode: process.env["BACKTEST_COMPLIANCE_MODE"] ?? "enforce",
    roll_spread_itemized: envBool("BACKTEST_ROLL_SPREAD_ITEMIZED", true),
    zero_volume_trade_critical_fail_loud: envBool(
      "BACKTEST_ZERO_VOLUME_TRADE_CRITICAL_FAIL_LOUD",
      true,
    ),
    // Framework overlay stop ceilings (CLAUDE.md §4: 14pt MES / 62pt MNQ / 1.00pt MCL)
    stop_ceiling_pts_mes: envFloat("STOP_CEILING_PTS_MES", 14),
    stop_ceiling_pts_mnq: envFloat("STOP_CEILING_PTS_MNQ", 62),
    stop_ceiling_pts_mcl: envFloat("STOP_CEILING_PTS_MCL", 1.0),
    // ATR floor multiplier (1.5 default per CLAUDE.md §4)
    stop_floor_atr_mult: envFloat("STOP_FLOOR_ATR_MULT", 1.5),
    // Style C canonical ratios — never env-controlled but included for traceability
    style_c_tp1_pct: 0.33,
    style_c_tp2_pct: 0.33,
    style_c_runner_pct: 0.34,
  };
}

/**
 * Compute SHA-256 of the effective overlay config.
 *
 * Same approach as firm-rules-version.ts and frozen-policy-hash.ts:
 * canonical-sorted-JSON → SHA-256 → 64-char lowercase hex.
 *
 * A change to any env-controlled framework parameter → different hash → rows
 * are marked non-comparable by inspection of this field.
 */
export function computeOverlayConfigHash(): string {
  const cfg = captureEffectiveOverlayConfig();
  const canonical = canonicalJson(cfg);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ─── Data snapshot ID ─────────────────────────────────────────────────────────

/**
 * Build a data_snapshot_id from the data slice descriptor.
 * Reuses computeDataHash() from result-hasher.ts (same canonical form).
 * Appends a source tag (e.g. "databento", "csv", "yfinance") so a data-source
 * change is visible even when symbol/TF/dates are unchanged.
 */
export function buildDataSnapshotId(
  symbol: string,
  timeframe: string,
  startDate: string,
  endDate: string,
  source = "databento",
): string {
  const hash = computeDataHash(symbol, timeframe, startDate, endDate);
  return `${hash}::${source}`;
}

// ─── Stamp type ───────────────────────────────────────────────────────────────

export interface ProvenanceStamp {
  engine_version: string;
  data_snapshot_id: string;
  gate_battery_version: string;
  overlay_config_hash: string;
  spec_provenance_ref: string;
  /** git SHA at runtime — appended to engine_version for traceability */
  git_sha: string;
  /** ISO timestamp when the stamp was built */
  stamped_at: string;
  /** true ONLY for legacy backfill rows (PROVENANCE_ALLOW_LEGACY_BACKFILL=true) */
  legacy?: boolean;
}

export interface ProvenanceStampOptions {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  /** Data source tag (default: "databento") */
  dataSource?: string;
  /**
   * compiled-spec identifier linking to the transcript→spec provenance chain.
   * Typically from config.strategy.metadata.extraction_provenance or .source.
   * Use "none" for manually-crafted strategies.
   */
  specProvenanceRef: string;
}

// ─── Build stamp ──────────────────────────────────────────────────────────────

/**
 * Build a provenance stamp for a backtest run.
 * Call this just before persisting the backtest row.
 */
export function buildProvenanceStamp(opts: ProvenanceStampOptions): ProvenanceStamp {
  const gitSha = process.env["FORGE_GIT_SHA"] ?? "unknown";
  return {
    engine_version: `${ENGINE_VERSION}+${gitSha}`,
    data_snapshot_id: buildDataSnapshotId(
      opts.symbol,
      opts.timeframe,
      opts.startDate,
      opts.endDate,
      opts.dataSource ?? "databento",
    ),
    gate_battery_version: GATE_BATTERY_VERSION,
    overlay_config_hash: computeOverlayConfigHash(),
    spec_provenance_ref: opts.specProvenanceRef,
    git_sha: gitSha,
    stamped_at: new Date().toISOString(),
  };
}

// ─── Hard gate validator ──────────────────────────────────────────────────────

export interface ProvenanceValidationResult {
  ok: boolean;
  /** field names that are missing or empty — populated when ok=false */
  missing: string[];
}

const REQUIRED_STAMP_FIELDS = [
  "engine_version",
  "data_snapshot_id",
  "gate_battery_version",
  "overlay_config_hash",
  "spec_provenance_ref",
] as const;

type RequiredField = (typeof REQUIRED_STAMP_FIELDS)[number];

/**
 * Validate a provenance stamp.
 * A stamp is valid when all five required fields are present and non-empty.
 * Legacy stamps (legacy=true) are exempt from the hard gate — they may have
 * sentinel values.
 */
export function validateProvenanceStamp(stamp: unknown): ProvenanceValidationResult {
  if (stamp === null || stamp === undefined || typeof stamp !== "object") {
    return { ok: false, missing: [...REQUIRED_STAMP_FIELDS] };
  }

  const s = stamp as Record<string, unknown>;

  // Legacy stamps are accepted as-is (they carry legacy=true)
  if (s["legacy"] === true) {
    return { ok: true, missing: [] };
  }

  const missing: string[] = [];
  for (const field of REQUIRED_STAMP_FIELDS) {
    const val = s[field as RequiredField];
    if (val === undefined || val === null || val === "" || val === "unknown") {
      missing.push(field);
    }
  }

  return { ok: missing.length === 0, missing };
}

// ─── Env gates ────────────────────────────────────────────────────────────────

/**
 * Whether provenance stamp enforcement is active.
 * Default ON (PROVENANCE_STAMP_ENFORCE=true).
 * Set false ONLY for test-seeding or emergency bypass — NOT for production use.
 */
export function isProvenanceEnforced(): boolean {
  const val = process.env["PROVENANCE_STAMP_ENFORCE"];
  if (val === undefined) return true; // default ON
  return val.toLowerCase() !== "false";
}

/**
 * Whether legacy backfill is allowed.
 * Default OFF (PROVENANCE_ALLOW_LEGACY_BACKFILL=false).
 * When true, missing stamp fields are filled with "legacy" sentinel values.
 * MUST remain default OFF — this is an operator escape hatch only.
 */
export function isLegacyBackfillAllowed(): boolean {
  return (process.env["PROVENANCE_ALLOW_LEGACY_BACKFILL"] ?? "false").toLowerCase() === "true";
}

// ─── Legacy backfill stamp ────────────────────────────────────────────────────

/**
 * Build a legacy stamp for rows that pre-date provenance stamping.
 * Only used when PROVENANCE_ALLOW_LEGACY_BACKFILL=true.
 * Fills whatever fields are derivable; marks the rest as "legacy".
 */
export function buildLegacyProvenanceStamp(
  opts: Partial<ProvenanceStampOptions> = {},
): ProvenanceStamp {
  const gitSha = process.env["FORGE_GIT_SHA"] ?? "unknown";
  const canComputeDataId =
    opts.symbol && opts.timeframe && opts.startDate && opts.endDate;
  return {
    engine_version: `legacy+${gitSha}`,
    data_snapshot_id: canComputeDataId
      ? buildDataSnapshotId(
          opts.symbol!,
          opts.timeframe!,
          opts.startDate!,
          opts.endDate!,
          opts.dataSource ?? "databento",
        )
      : "legacy",
    gate_battery_version: "legacy",
    overlay_config_hash: "legacy",
    spec_provenance_ref: opts.specProvenanceRef ?? "legacy",
    git_sha: gitSha,
    stamped_at: new Date().toISOString(),
    legacy: true,
  };
}

// ─── Hard gate assert ─────────────────────────────────────────────────────────

export class ProvenanceStampError extends Error {
  readonly missingFields: string[];
  constructor(missingFields: string[]) {
    super(
      `PROVENANCE_STAMP: persistence refused — missing required stamp fields: [${missingFields.join(", ")}]. ` +
        `Set PROVENANCE_ALLOW_LEGACY_BACKFILL=true ONLY for legacy backfill, or provide all stamp fields.`,
    );
    this.name = "ProvenanceStampError";
    this.missingFields = missingFields;
  }
}

/**
 * Assert that a stamp is valid and enforcement is satisfied.
 *
 * Throws ProvenanceStampError when:
 *   - enforcement is ON (default) AND stamp is invalid
 *
 * Returns stamp unchanged when:
 *   - enforcement is ON and stamp is valid, OR
 *   - enforcement is OFF (test/emergency escape)
 *
 * When legacy backfill IS allowed (PROVENANCE_ALLOW_LEGACY_BACKFILL=true):
 *   - replaces a null/missing stamp with buildLegacyProvenanceStamp()
 *   - does NOT throw even when stamp is null/incomplete
 */
export function assertProvenanceStamp(
  stamp: ProvenanceStamp | null | undefined,
  backfillOpts: Partial<ProvenanceStampOptions> = {},
): ProvenanceStamp {
  if (!isProvenanceEnforced()) {
    // enforcement OFF — return as-is; no gate
    return stamp ?? buildLegacyProvenanceStamp(backfillOpts);
  }

  if (!stamp) {
    if (isLegacyBackfillAllowed()) {
      return buildLegacyProvenanceStamp(backfillOpts);
    }
    throw new ProvenanceStampError([...REQUIRED_STAMP_FIELDS]);
  }

  const result = validateProvenanceStamp(stamp);
  if (!result.ok) {
    if (stamp.legacy === true) {
      // legacy stamps pass the gate — sentinel values are expected
      return stamp;
    }
    throw new ProvenanceStampError(result.missing);
  }

  return stamp;
}

// ─── Config derivation helper ─────────────────────────────────────────────────

/**
 * Derive spec_provenance_ref from a backtest config object.
 * Walks common metadata paths in the compiled strategy config.
 * Returns "none" for manually-crafted strategies without provenance.
 */
export function deriveSpecProvenanceRef(config: Record<string, unknown>): string {
  const strategy = config["strategy"] as Record<string, unknown> | undefined;
  const metadata = strategy?.["metadata"] as Record<string, unknown> | undefined;

  // Prefer explicit extraction provenance fields
  const extractionRef =
    (metadata?.["extraction_provenance"] as string | undefined) ??
    (metadata?.["extraction_run_id"] as string | undefined) ??
    (metadata?.["scout_audit_id"] as string | undefined);
  if (extractionRef && extractionRef !== "none") return extractionRef;

  // Fall back to source URL (YouTube / Reddit / web)
  const sourceUrl =
    (metadata?.["source_url"] as string | undefined) ??
    (strategy?.["source_url"] as string | undefined);
  if (sourceUrl) return sourceUrl;

  // Fall back to source tag (skip manual/openclaw — those are not provenance refs)
  const source =
    (metadata?.["source"] as string | undefined) ??
    (config["source"] as string | undefined);
  if (source && source !== "manual" && source !== "openclaw") return source;

  return "none";
}
