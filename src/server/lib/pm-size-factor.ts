/**
 * pm-size-factor.ts — Wave 26 Pass K Phase 2 (2026-05-26)
 *
 * EOD-DD-aware PM session size taper. Returns a multiplier in [0, 1] that
 * scales `base_contracts` BEFORE the firm cap / liquidity cap minimum is
 * computed in `framework-overlay.ts::computeRiskDerivedContracts()`.
 *
 * Why this taper (vs full-size PM trades):
 *   - TTT Markets 2026-04 funded-account framework: explicit recommendation
 *     of 50% risk reduction in Transition Zone 13:00–16:00 ET.
 *   - SurgeFunded 2026-02 EOD trailing DD guide: "Cut your bleeding trades
 *     before the market closes to prevent a massive drop in your safety net."
 *     PM losers permanently ratchet down the floor.
 *   - Tradecovex 2026-04 trailing DD guide: chain-of-small-losses-after-HWM
 *     is the primary funded account failure pattern; Topstep EOD MLL
 *     mechanics make this acute in the PM window.
 *
 * Why linear decay (not stepped or exponential):
 *   - Linear matches the shrinking-recovery-window intuition (every minute
 *     past 13:30 ET reduces the time-buffer for a losing trade to recover
 *     before 15:55 hard flatten).
 *   - 50% → 25% over 13:30 → 15:00 = -16.67% per 30 min, then floor at 25%
 *     until the PM_LAST_ENTRY_ET (15:30 ET default) where size becomes 0
 *     (no new entries).
 *
 * Boundaries:
 *   - Before 13:30 ET → factor 1.0 (full AM size — not in PM session yet)
 *   - 13:30:00 ET → 0.50
 *   - 14:15:00 ET → 0.375 (halfway between 13:30 and 15:00)
 *   - 15:00:00 ET → 0.25 (floor reached)
 *   - 15:00:00 → 15:30:00 ET → 0.25 (held at floor)
 *   - 15:30:00 ET and after → 0.0 (no new entries; 15:55 flatten still active for OPEN positions)
 *
 * Pure-function design:
 *   - Feeds in `barTsUtc` + 4 boundary configs → returns factor.
 *   - No I/O, no LLM, no Date.now() — replay-deterministic.
 *   - Caller (framework-overlay.ts) applies the factor inside the existing
 *     `computeRiskDerivedContracts()` math.
 *
 * Failure mode:
 *   - Malformed config → return 0.25 (floor) as conservative fallback. Better
 *     to size DOWN than UP on misconfiguration.
 */

export interface PmSizeFactorInput {
  /** Bar timestamp (UTC). */
  barTsUtc: Date;
  /** PM session start time, "HH:MM" in ET. Default "13:30". */
  pmStartEt?: string;
  /** Time at which the floor is reached, "HH:MM" in ET. Default "15:00". */
  pmFloorAtEt?: string;
  /** Time at which all PM entries are blocked, "HH:MM" in ET. Default "15:30". */
  pmLastEntryEt?: string;
  /** Initial PM size factor at pmStartEt. Default 0.50. */
  factorAtStart?: number;
  /** Floor PM size factor at pmFloorAtEt. Default 0.25. */
  factorAtFloor?: number;
}

export interface PmSizeFactorResult {
  /** Multiplier in [0, 1] applied to base_contracts. */
  factor: number;
  /** Phase: am | pm_taper | pm_floor | pm_closed */
  phase: "am" | "pm_taper" | "pm_floor" | "pm_closed";
  /** Wall-clock ET minute-of-day (echoed for audit). */
  etMinuteOfDay: number;
  /** Human-readable reason for audit row. */
  reason: string;
}

/**
 * Compute ET minute-of-day from a UTC timestamp.
 * Uses Intl.DateTimeFormat for DST-correct conversion.
 */
function toEtMinuteOfDay(tsUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(tsUtc);
  let h = 0;
  let m = 0;
  for (const part of parts) {
    if (part.type === "hour") {
      h = parseInt(part.value, 10);
      if (h === 24) h = 0;
    } else if (part.type === "minute") {
      m = parseInt(part.value, 10);
    }
  }
  return h * 60 + m;
}

/**
 * Parse "HH:MM" to minute-of-day. Returns null on malformed input.
 */
function parseHhMm(s: string): number | null {
  if (typeof s !== "string") return null;
  const parts = s.trim().split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Read env defaults. Centralized for testability.
 */
export function getPmSizeFactorEnvDefaults(): Required<Omit<PmSizeFactorInput, "barTsUtc">> {
  const pmStartEt = (process.env.PM_SESSION_START_ET || "13:30").trim();
  const pmFloorAtEt = (process.env.PM_SIZE_FACTOR_FLOOR_AT_ET || "15:00").trim();
  const pmLastEntryEt = (process.env.PM_LAST_ENTRY_ET || "15:30").trim();

  const factorAtStartRaw = process.env.PM_SIZE_FACTOR_AT_13_30;
  const factorAtFloorRaw = process.env.PM_SIZE_FACTOR_AT_15_00;
  const factorAtStart = factorAtStartRaw !== undefined && factorAtStartRaw !== ""
    ? Number(factorAtStartRaw)
    : 0.50;
  const factorAtFloor = factorAtFloorRaw !== undefined && factorAtFloorRaw !== ""
    ? Number(factorAtFloorRaw)
    : 0.25;

  return {
    pmStartEt,
    pmFloorAtEt,
    pmLastEntryEt,
    factorAtStart: Number.isFinite(factorAtStart) ? factorAtStart : 0.50,
    factorAtFloor: Number.isFinite(factorAtFloor) ? factorAtFloor : 0.25,
  };
}

/**
 * Compute the PM size factor for a given bar timestamp.
 *
 * Pure-function. Returns a structured result for audit + caller-side
 * downstream sizing logic. The factor is in [0, 1] and is multiplied by
 * `base_contracts` BEFORE the firm cap / liquidity cap minimum.
 */
export function computePmSizeFactor(input: PmSizeFactorInput): PmSizeFactorResult {
  const env = getPmSizeFactorEnvDefaults();
  const pmStartEt = input.pmStartEt ?? env.pmStartEt;
  const pmFloorAtEt = input.pmFloorAtEt ?? env.pmFloorAtEt;
  const pmLastEntryEt = input.pmLastEntryEt ?? env.pmLastEntryEt;
  const factorAtStart = input.factorAtStart ?? env.factorAtStart;
  const factorAtFloor = input.factorAtFloor ?? env.factorAtFloor;

  const startMin = parseHhMm(pmStartEt);
  const floorMin = parseHhMm(pmFloorAtEt);
  const lastEntryMin = parseHhMm(pmLastEntryEt);

  // Misconfig → conservative fallback (floor factor, audit will surface)
  if (
    startMin === null || floorMin === null || lastEntryMin === null ||
    !Number.isFinite(factorAtStart) || !Number.isFinite(factorAtFloor) ||
    factorAtStart < 0 || factorAtStart > 1 ||
    factorAtFloor < 0 || factorAtFloor > 1 ||
    floorMin <= startMin || lastEntryMin < floorMin
  ) {
    return {
      factor: 0.25,
      phase: "pm_floor",
      etMinuteOfDay: -1,
      reason: "pm_size_factor_config_error:fallback_to_floor=0.25",
    };
  }

  const etMin = toEtMinuteOfDay(input.barTsUtc);

  // Phase: AM (before PM start) — full size
  if (etMin < startMin) {
    return {
      factor: 1.0,
      phase: "am",
      etMinuteOfDay: etMin,
      reason: `am_session: full base size (factor=1.0)`,
    };
  }

  // Phase: PM closed — no new entries
  if (etMin >= lastEntryMin) {
    return {
      factor: 0.0,
      phase: "pm_closed",
      etMinuteOfDay: etMin,
      reason: `pm_closed: no new entries after ${pmLastEntryEt} ET (15:55 flatten still active for open positions)`,
    };
  }

  // Phase: PM floor — held at floor between floorMin and lastEntryMin
  if (etMin >= floorMin) {
    return {
      factor: factorAtFloor,
      phase: "pm_floor",
      etMinuteOfDay: etMin,
      reason: `pm_floor: factor=${factorAtFloor} held until ${pmLastEntryEt} ET (Topstep EOD trailing DD aware sizing per TTT Markets 2026-04)`,
    };
  }

  // Phase: PM taper — linear interpolation between factorAtStart and factorAtFloor
  // from startMin to floorMin
  const progress = (etMin - startMin) / (floorMin - startMin);  // [0, 1)
  const factor = factorAtStart + progress * (factorAtFloor - factorAtStart);

  return {
    factor: Number(factor.toFixed(6)),
    phase: "pm_taper",
    etMinuteOfDay: etMin,
    reason: `pm_taper: linear decay ${factorAtStart} → ${factorAtFloor} from ${pmStartEt} → ${pmFloorAtEt} ET (CLAUDE.md §4)`,
  };
}
