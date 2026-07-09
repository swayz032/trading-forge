/**
 * fade-inverter.ts — Wave B "Fade-the-Losers" pure inversion (2026-07-03)
 *
 * PURE, DETERMINISTIC, NO I/O. Given a consistently-losing DIRECTIONAL strategy
 * config, produce the inverted config (short a persistent long-loser, long a
 * persistent short-loser). The inverted config is then created as a NEW
 * CANDIDATE through the SAME unchanged gate ladder every other strategy walks
 * (fade-the-losers-service.ts) — this file invents no gate and touches no DB.
 *
 * What it does (design 2026-07-03-fade-the-losers-design.md §Inversion):
 *   - Swap `direction` long↔short (top-level + strategy.* if present).
 *   - Swap `entry_long` ↔ `entry_short`: the losing entry condition becomes the
 *     opposite-direction entry hypothesis; the now-untraded side is forced to
 *     BIDIR_SENTINEL ("high < low" — the exact sentinel from
 *     direct-bucket-graduator.ts:293).
 *   - Drop entry prose fields (a flipped "buy when…"/"sell when…" would be
 *     misleading and is not engine-evaluated; the service regenerates the
 *     human description from the inversion metadata).
 *   - Stamp provenance: `config.faded_from = <orig id>`, `source = "fade_the_losers"`.
 *
 * What it deliberately does NOT touch:
 *   - stop_loss (ATR-bounded) / take_profit / exit_params / Style-C exits — they
 *     are STRUCTURAL and flip with direction automatically (inverting = double-negate).
 *   - symbol(s) / timeframe / position_size (sizing) / confluence factors.
 *   - REGIME (`regime_gate.preferred_regime` / `preferred_regimes`) — PRESERVED,
 *     never flipped: fading the exact losers means shorting the same trigger under
 *     the SAME regime filter, so the fade fires on the same bar set as the loser
 *     (flipping the regime would create a new, untested strategy instead).
 *
 * Refuses (discriminated result, never fabricates): `direction: both` (no
 * directional bias to flip), non-directional (neither/both sides sentinel),
 * missing direction, and an already-faded config (no fade-of-fade — prevents an
 * infinite invert loop).
 *
 * Leaf-module logger import per repo hard convention (AGENTS.md §5).
 */
import { logger } from "./logger.js";

/**
 * The deliberate never-true sentinel for a disabled direction side (W23F.L
 * convention). Byte-identical to the private BIDIR_SENTINEL in
 * direct-bucket-graduator.ts:293 — a documented, intentional literal match.
 */
export const BIDIR_SENTINEL = "high < low";

/** Source tag every faded strategy carries (statistical-honesty / corpus-FDR). */
export const FADE_SOURCE = "fade_the_losers";

type Dict = Record<string, unknown>;

export interface FadeInverterInput {
  /** The ORIGINAL (already framework-overlaid) strategy config JSONB. */
  config: Dict;
  /** The original strategy's UUID — stamped as config.faded_from provenance. */
  originalId: string;
  /** The original strategy's name — the fade name is `canonical(name + "_fade")`. */
  originalName: string;
}

export type FadeSkipReason =
  | "direction_both"
  | "not_directional"
  | "already_faded"
  | "missing_direction";

export type InvertResult =
  | {
      ok: true;
      config: Dict;
      /** Canonicalized fade name (orig + "_fade"). */
      name: string;
      /** Original strategy id (provenance closure — mirrors config.faded_from). */
      fadedFrom: string;
      originalDirection: "long" | "short";
      invertedDirection: "long" | "short";
    }
  | { ok: false; reason: FadeSkipReason };

function deepClone(v: Dict): Dict {
  return JSON.parse(JSON.stringify(v)) as Dict;
}

/** A side is "disabled"/untraded when it is the sentinel or empty/blank. */
function isDisabledSide(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  return s.length === 0 || s === BIDIR_SENTINEL;
}

function readDirection(config: Dict): string | null {
  const top = config.direction;
  if (typeof top === "string" && top.length > 0) return top.toLowerCase();
  const strat = config.strategy as Dict | undefined;
  const nested = strat?.direction;
  if (typeof nested === "string" && nested.length > 0) return nested.toLowerCase();
  return null;
}

function isAlreadyFaded(config: Dict): boolean {
  if (config.faded_from != null) return true;
  if (config.source === FADE_SOURCE) return true;
  const meta = config.metadata as Dict | undefined;
  if (meta?.source === FADE_SOURCE || meta?.faded_from != null) return true;
  return false;
}

/** Reads entry_long/entry_short, preferring strategy.* then top-level. */
function readEntries(config: Dict): { longVal: string; shortVal: string } {
  const strat = config.strategy as Dict | undefined;
  const longVal = String((strat?.entry_long ?? config.entry_long) ?? "");
  const shortVal = String((strat?.entry_short ?? config.entry_short) ?? "");
  return { longVal, shortVal };
}

/** Writes the new entries to strategy.* and to top-level if they existed there. */
function writeEntries(config: Dict, newLong: string, newShort: string): void {
  const strat = config.strategy as Dict | undefined;
  if (strat && ("entry_long" in strat || "entry_short" in strat)) {
    strat.entry_long = newLong;
    strat.entry_short = newShort;
  }
  if ("entry_long" in config || "entry_short" in config) {
    config.entry_long = newLong;
    config.entry_short = newShort;
  }
  // If neither container carried the keys (defensive), stamp the canonical spot.
  const stratHas = strat && ("entry_long" in strat || "entry_short" in strat);
  const topHas = "entry_long" in config || "entry_short" in config;
  if (!stratHas && !topHas) {
    if (strat) {
      strat.entry_long = newLong;
      strat.entry_short = newShort;
    } else {
      config.entry_long = newLong;
      config.entry_short = newShort;
    }
  }
}

function canonicalizeFadeName(originalName: string): string {
  const base = originalName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const safe = base.length > 0 ? base : "unnamed";
  return safe.endsWith("_fade") ? safe : `${safe}_fade`;
}

/**
 * Invert a fadeable directional strategy config. Pure — clones its input, never
 * mutates it. Returns a discriminated result; never fabricates a fade for a
 * `both`/non-directional/already-faded input.
 */
export function invertStrategyConfig(input: FadeInverterInput): InvertResult {
  const { originalId, originalName } = input;
  const config = deepClone(input.config);

  // ── No fade-of-fade (loop guard) ──────────────────────────────────────────
  if (isAlreadyFaded(config)) {
    return { ok: false, reason: "already_faded" };
  }

  // ── Direction must be a clean single side ─────────────────────────────────
  const direction = readDirection(config);
  if (direction == null) return { ok: false, reason: "missing_direction" };
  if (direction === "both") return { ok: false, reason: "direction_both" };
  if (direction !== "long" && direction !== "short") {
    return { ok: false, reason: "missing_direction" };
  }

  // ── Exactly one entry side must be the sentinel (directional) AND the
  // active side must AGREE with the declared direction ──────────────────────
  const { longVal, shortVal } = readEntries(config);
  const longDisabled = isDisabledSide(longVal);
  const shortDisabled = isDisabledSide(shortVal);
  if (longDisabled === shortDisabled) {
    // both disabled (degenerate) or both active (bidirectional-ish) — not a
    // clean directional loser to invert.
    return { ok: false, reason: "not_directional" };
  }
  // The ACTIVE (non-sentinel) side must be the one `direction` claims to trade.
  // A `direction:"long"` strategy whose ONLY active side is entry_short is
  // incoherent (contradictory config) — refuse rather than fabricate a fade.
  const activeSide: "long" | "short" = longDisabled ? "short" : "long";
  if (activeSide !== direction) {
    return { ok: false, reason: "not_directional" };
  }

  // The losing entry condition = the ACTIVE (non-sentinel) side.
  const activeCondition = longDisabled ? shortVal : longVal;
  const invertedDirection: "long" | "short" = direction === "long" ? "short" : "long";

  // Move the losing condition onto the opposite direction; sentinel the other.
  const newLong = invertedDirection === "long" ? activeCondition : BIDIR_SENTINEL;
  const newShort = invertedDirection === "short" ? activeCondition : BIDIR_SENTINEL;

  // ── Apply the flip ────────────────────────────────────────────────────────
  writeEntries(config, newLong, newShort);

  config.direction = invertedDirection;
  const strat = config.strategy as Dict | undefined;
  if (strat && typeof strat.direction === "string") strat.direction = invertedDirection;

  // Entry prose (human-readable "buy when…"/"sell when…") would be MISLEADING
  // after a direction flip and is not evaluated by the engine — drop it rather
  // than move the verbatim text to the opposite side. Downstream description
  // is regenerated by the service from the inversion metadata.
  delete config.entry_long_prose;
  delete config.entry_short_prose;
  if (strat) {
    delete strat.entry_long_prose;
    delete strat.entry_short_prose;
  }

  // REGIME IS PRESERVED, NOT FLIPPED. To fade the exact losers we short the
  // SAME trigger under the SAME regime filter — flipping preferred_regime would
  // fire the fade on a disjoint bar set (a new untested strategy, not the
  // inverse). regime_gate / preferred_regime / preferred_regimes are left as-is.

  // ── Provenance stamp (chain closed: fade -> original) ─────────────────────
  config.faded_from = originalId;
  config.source = FADE_SOURCE;
  const meta = (config.metadata as Dict | undefined) ?? {};
  config.metadata = { ...meta, source: FADE_SOURCE, faded_from: originalId };

  const name = canonicalizeFadeName(originalName);

  logger.debug(
    { originalId, originalName, name, from: direction, to: invertedDirection },
    "fade.inverted_config",
  );

  return {
    ok: true,
    config,
    name,
    fadedFrom: originalId,
    originalDirection: direction,
    invertedDirection,
  };
}
