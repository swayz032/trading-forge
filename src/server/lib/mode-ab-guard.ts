/**
 * mode-ab-guard.ts — roadmap Band E, items E1 + E4 (2026-07-02)
 *
 * Thin, DB-free TS mirror of the governance-label + threshold contract used by
 * scripts/full-battery-mode-ab.py (the Mode A/B full-battery orchestration harness).
 *
 * WHY THIS FILE EXISTS (and why it is intentionally small):
 *   The full-battery Mode A/B comparison runs entirely in Python, standalone against the
 *   engine (see that script's module docstring for why — TF_CONFLUENCE_OVERLAY_DISABLED is a
 *   process-wide env var the running Node server cannot be remote-controlled into flipping per
 *   request). This file does NOT orchestrate anything — it exists so that:
 *     1. The E4 A+ retention floor is a single named constant shared by BOTH the Python verdict
 *        math and any future TS consumer (dashboard tile, docs generator, etc.) instead of two
 *        independently-drifting magic numbers.
 *     2. The mode_ab governance-label shape has a TS-side contract, mirroring the
 *        null_calibration_guard.py / replay_mode / ablation-marker precedent, so a future
 *        TS caller that reads full_battery_mode_ab_manifest.jsonl rows (e.g. a report viewer)
 *        can validate them the same way src/engine/null_calibration_guard.py validates its
 *        Python-side rows.
 *   This module imports NOTHING from ../db/index.js — safe for tests, safe to import from any
 *   context. It does not touch src/engine/** or src/server/lib/provenance-stamp.ts.
 *
 * COORDINATION FINDING (see scripts/full-battery-mode-ab.py docstring for the full writeup):
 *   provenance-stamp.ts::computeOverlayConfigHash() does NOT read TF_CONFLUENCE_OVERLAY_DISABLED
 *   — Mode A and Mode B rows would hash identically if ever persisted through the normal
 *   backtest-service.ts INSERT path (they are not; the harness is file-only output). This module
 *   does not attempt to fix that (provenance-stamp.ts is outside this agent's file boundary) —
 *   OVERLAY_CONFIG_HASH_OMITS_MODE_TOGGLE below documents the gap for anyone auditing it later.
 */

// ─── E4: A+ retention floor ────────────────────────────────────────────────────────────────────

/**
 * OVERLAY_APLUS_RETENTION_FLOOR — minimum fraction (0-1) of Mode A's A+ (>= APLUS_POINTS point)
 * OOS winners that Mode B (overlay ON) must still take for an overlay change to be considered
 * for unfreezing (docs/overlay-unfreeze-protocol.md condition (c)).
 *
 * MUST stay numerically identical to scripts/full-battery-mode-ab.py's
 * OVERLAY_APLUS_RETENTION_FLOOR (same env var, same default 0.80). If you change the default
 * here, change it there in the SAME commit — the protocol doc cites both.
 */
export function getOverlayAplusRetentionFloor(): number {
  const raw = process.env["OVERLAY_APLUS_RETENTION_FLOOR"];
  if (raw === undefined || raw === "") return 0.8;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.8;
}

/** Convenience constant snapshot — for callers that don't need live env re-reads. */
export const OVERLAY_APLUS_RETENTION_FLOOR_DEFAULT = 0.8;

// ─── Coordination finding marker (documentation-as-code, not a runtime check) ────────────────

/**
 * OVERLAY_CONFIG_HASH_OMITS_MODE_TOGGLE — true today (2026-07-02). Set to false the day
 * provenance-stamp.ts::EffectiveOverlayConfig is extended to read TF_CONFLUENCE_OVERLAY_DISABLED
 * and this constant is updated in the SAME commit as evidence the gap was closed. Until then,
 * any code that compares two backtests' overlay_config_hash values MUST NOT assume a match means
 * "same overlay mode" — it does not capture the confluence-overlay toggle.
 */
export const OVERLAY_CONFIG_HASH_OMITS_MODE_TOGGLE = true;

// ─── mode_ab governance label contract (mirrors null_calibration_guard.py) ────────────────────

export type ModeAbMode = "A" | "B";

export interface ModeAbLabels {
  governance_advisory: true;
  mode_ab_battery: true;
  persist_to_production: false;
  authority: string;
  spec_id: string;
  mode: ModeAbMode;
  overlay_disabled: boolean;
  tf_confluence_overlay_disabled_env: "true" | "false";
}

const MODE_AB_AUTHORITY =
  "research_only -- verdicts inform the overlay-unfreeze protocol " +
  "(docs/overlay-unfreeze-protocol.md); overlay remains FROZEN; never auto-applied; " +
  "never persisted as a production backtest/MC row";

/**
 * Build a mode_ab governance-label object. Structural mirror of
 * scripts/full-battery-mode-ab.py::build_mode_ab_labels() — field names and values must match
 * exactly so a TS reader parsing the Python-authored manifest JSONL sees a shape it recognizes.
 */
export function buildModeAbLabels(specId: string, mode: ModeAbMode, overlayDisabled: boolean): ModeAbLabels {
  return {
    governance_advisory: true,
    mode_ab_battery: true,
    persist_to_production: false,
    authority: MODE_AB_AUTHORITY,
    spec_id: specId,
    mode,
    overlay_disabled: overlayDisabled,
    tf_confluence_overlay_disabled_env: overlayDisabled ? "true" : "false",
  };
}

export interface ModeAbValidationResult {
  ok: boolean;
  /** human-readable reasons — empty when ok=true */
  errors: string[];
}

/**
 * Validate a mode_ab labels object. Fail-closed contract mirroring
 * scripts/full-battery-mode-ab.py::validate_mode_ab_labels(). Nothing in this codebase persists
 * mode-A/B rows to a DB today (file-only output by design — see the Python script's governance
 * contract section), so this is a forward-compatible guard: any future TS code that DOES want to
 * ingest/persist a mode-A/B result MUST call this first and refuse on ok=false.
 */
export function validateModeAbLabels(labels: unknown): ModeAbValidationResult {
  const errors: string[] = [];

  if (labels === null || typeof labels !== "object") {
    return { ok: false, errors: ["labels must be an object"] };
  }
  const l = labels as Record<string, unknown>;

  if (l["mode_ab_battery"] !== true) {
    errors.push("missing required mode_ab_battery: true marker (replay_mode/null_calibration precedent)");
  }
  if (l["mode"] !== "A" && l["mode"] !== "B") {
    errors.push(`mode must be "A" or "B", got ${JSON.stringify(l["mode"])}`);
  }
  if (typeof l["overlay_disabled"] !== "boolean") {
    errors.push("overlay_disabled must be a boolean");
  }
  if (l["persist_to_production"] !== false) {
    errors.push("persist_to_production must be false — mode-A/B results are never production verdicts");
  }
  if (typeof l["spec_id"] !== "string" || l["spec_id"] === "") {
    errors.push("spec_id must be a non-empty string");
  }

  return { ok: errors.length === 0, errors };
}

export class ModeAbValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`mode_ab_guard: invalid labels — ${errors.join("; ")}`);
    this.name = "ModeAbValidationError";
    this.errors = errors;
  }
}

/** Throwing variant — use where a caller wants fail-closed behavior instead of a result object. */
export function assertModeAbLabels(labels: unknown): asserts labels is ModeAbLabels {
  const result = validateModeAbLabels(labels);
  if (!result.ok) {
    throw new ModeAbValidationError(result.errors);
  }
}
