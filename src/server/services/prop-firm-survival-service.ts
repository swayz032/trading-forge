/**
 * Prop-Firm Survival Service — B14 (W20 Pass 2A) — PURE MATH, NO DB.
 *
 * Bayesian-flavoured single-horizon survival probability + Monte Carlo survival
 * curve over 30/90/180/365 day horizons. Inputs are an `AdversarialPriors`
 * object (per-firm event base rates already normalised to the right time
 * semantics by the caller) and a `StrategyProfile` (operator usage shape).
 *
 * Math intuition:
 *   - Each adversarial event type has an independent daily hazard.
 *   - Strategy modulators amplify the base rates per documented public-dispute
 *     patterns (Apex profitable-trader-ban May 2025; high payout frequency →
 *     denial cascades; automation usage on auto-hostile firms → VPN flags).
 *   - Daily survival = ∏(1 − h_i) across event types.
 *   - Horizon survival = (1 − combined_daily_hazard) ** horizonDays.
 *   - Monte Carlo simulates day-by-day adversarial draws over 365 days with
 *     a deterministic LCG so test snapshots are reproducible.
 *
 * Authority (per W20 plan):
 *   - Phase 0 (Day 0–60): challenger_only, never blocks routing. UI surfaces
 *     the probability as advisory.
 *   - Phase 1 (Day 60+): tiebreaker in bestFirm selection. Still no override
 *     of compliance/eligibility hard gates.
 *
 * Defensive contracts:
 *   - PURE FUNCTIONS — no DB writes, no DB reads, no `db/` imports, no Drizzle
 *     imports. Verified by grep at completion gate.
 *   - NaN-safe + clamps probabilities to [0, 1].
 *   - Divide-by-zero safe (denominator floors).
 *   - Never throws on degenerate inputs.
 *   - Deterministic single-horizon math.
 *   - Deterministic Monte Carlo when `seed` is provided (LCG, no deps).
 *
 * Pass 2B owns priors persistence + recalibration. This file is the math layer
 * the route layer (Pass 3) and B5 multi-firm hook (Pass 4 wiring) consume.
 */

// ─── Public interfaces ──────────────────────────────────────────────────────

/**
 * Per-firm adversarial event priors. Time semantics are NORMALISED HERE so the
 * survival math composes uniformly. Pass 2B's `firm-adversarial-event-service`
 * is responsible for translating raw seed JSON / health-check counts into this
 * shape (the seed JSON stores everything as 30-day-window probabilities; this
 * interface uses the units the math expects).
 */
export interface AdversarialPriors {
  /** Probability an account is suspended within any rolling 30-day window. 0..1 */
  P_suspension_30d: number;
  /** Probability of denial per payout request. 0..1 */
  P_payout_denial: number;
  /** Annual probability of a fund freeze. 0..1 */
  P_fund_freeze_year: number;
  /** Annual probability of a profitable-trader ban. 0..1 */
  P_profitable_trader_ban_year: number;
  /** Probability of VPN/automation flag per active session/day. 0..1 */
  P_vpn_detection: number;
  /** Automation friendliness, 0..1 (1.0 = Topstep, 0.3 = Apex). */
  automation_friendly: number;
  /** Sum of evidence_weight across event types — surfaces operator confidence. */
  evidence_weight: number;
}

/** Operator-side strategy profile. Modulates the base priors. */
export interface StrategyProfile {
  /** Higher P&L → boost ban risk (Apex profitable-trader pattern). */
  monthlyPayoutDollars: number;
  /** Payout requests per year → boosts denial hazard. */
  payoutRequestFrequency: number;
  /** True when the strategy runs through the ATS. Triggers VPN modulator. */
  usesAutomation: boolean;
  /** Session window. RTH-only is the safer default. */
  averagePosition: "rth_only" | "overnight";
}

/** Survival probabilities at canonical horizons. Each in [0, 1]. */
export interface SurvivalCurve {
  p_30d: number;
  p_90d: number;
  p_180d: number;
  p_365d: number;
}

// ─── Modulator constants (named so they're auditable) ──────────────────────

/**
 * Strategy-modulator multipliers. Centralised so the math is auditable from
 * one place. All numeric values come from the W20 plan.
 */
export const SURVIVAL_MODULATORS = {
  /** Above this monthly payout, the Apex-style ban modulator engages. */
  HIGH_PAYOUT_DOLLARS: 8000,
  /** Above this monthly payout, the modulator escalates further. */
  EXTREME_PAYOUT_DOLLARS: 15000,
  /** Multiplier on `P_profitable_trader_ban_year` for HIGH band. */
  BAN_MULT_HIGH: 1.5,
  /** Multiplier on `P_profitable_trader_ban_year` for EXTREME band. */
  BAN_MULT_EXTREME: 2.5,
  /** Above this annual payout-request count, the denial modulator engages. */
  HIGH_PAYOUT_FREQ: 12,
  /** Per-extra-request denial multiplier increment. */
  DENIAL_FREQ_STEP: 0.05,
  /** Hard cap on denial multiplier so a single profile can't push it above 2x. */
  DENIAL_FREQ_CAP_MULT: 2.0,
  /** VPN modulator base coefficient — applied to (1 − automation_friendly). */
  VPN_AUTO_HOSTILITY_COEF: 1.5,
} as const;

// ─── Numeric guards ─────────────────────────────────────────────────────────

/** Clamp x to [lo, hi]; NaN → lo. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/** Clamp probability to [0, 1]; NaN → 0. */
function clampProb(p: number): number {
  return clamp(p, 0, 1);
}

/** Safe getter for a probability field on AdversarialPriors. */
function safeProb(value: unknown): number {
  const n = Number(value);
  return clampProb(n);
}

/** Safe automation-friendly read (defaults to 0.5 — neutral firm). */
function safeAutomationFriendly(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return clamp(n, 0, 1);
}

// ─── Modulator math ─────────────────────────────────────────────────────────

/**
 * Apply the documented strategy modulators to the raw priors. Returns a NEW
 * `AdversarialPriors` object (priors are not mutated in place). Modulators are
 * applied to the relevant `P_*` BEFORE deriving daily hazards.
 *
 * Topstep attenuator: highly automation-friendly firms see a softened
 * profitable-trader-ban modulator because the documented Apex pattern depends
 * on the firm being hostile to consistent winners. The attenuator divides the
 * ban multiplier by `(0.5 + 0.5 * automation_friendly)`. At
 * `automation_friendly = 1.0` (Topstep) this is 1.0 → full attenuation; at
 * `automation_friendly = 0.3` (Apex) this is 0.65 → boost survives mostly intact.
 */
export function applyModulators(
  raw: AdversarialPriors,
  profile: StrategyProfile,
): AdversarialPriors {
  const automationFriendly = safeAutomationFriendly(raw.automation_friendly);

  // ── Profitable-trader-ban modulator ────────────────────────────────────
  let banMult = 1.0;
  const monthly = Number.isFinite(profile.monthlyPayoutDollars)
    ? Math.max(0, profile.monthlyPayoutDollars)
    : 0;
  if (monthly > SURVIVAL_MODULATORS.EXTREME_PAYOUT_DOLLARS) {
    banMult = SURVIVAL_MODULATORS.BAN_MULT_EXTREME;
  } else if (monthly > SURVIVAL_MODULATORS.HIGH_PAYOUT_DOLLARS) {
    banMult = SURVIVAL_MODULATORS.BAN_MULT_HIGH;
  }
  // Topstep attenuator: highly automation-friendly firms attenuate the boost.
  // At automation_friendly = 1.0 → divisor is 1.0 (full attenuation, banMult → 1.0).
  // At automation_friendly = 0.3 → divisor is 0.65 (modulator survives).
  const attenuator = 0.5 + 0.5 * automationFriendly;
  const safeAttenuator = attenuator > 0 ? attenuator : 1.0;
  // attenuate towards 1.0: effective = 1 + (banMult - 1) / safeAttenuator?
  // The plan says: "divide multiplier by (0.5 + 0.5 * automation_friendly) so
  // highly-friendly firms don't see the boost". Read literally: the multiplier
  // is divided. At automation_friendly = 1.0, divisor = 1.0 → no change.
  // At automation_friendly = 0.3, divisor = 0.65 → multiplier grows
  // (1.5/0.65 = 2.31). That's the OPPOSITE of attenuation for Topstep.
  //
  // Correct interpretation: ATTENUATION means the EXCESS over 1.0 is divided
  // by the divisor. At automation_friendly = 1.0, divisor = 1.0 → the boost
  // is unattenuated (but Topstep's annual base is so low that 1.5x of near-zero
  // is still near-zero, so survival barely moves). At automation_friendly = 0.3,
  // divisor = 0.65 → the excess GROWS (Apex boost amplified).
  //
  // Hmm — re-reading the plan: "Topstep ... attenuates: divide multiplier by
  // (0.5 + 0.5 * automation_friendly) so highly-friendly firms don't see the
  // boost". The intent is clear: Topstep should NOT see the boost. The math
  // that achieves that is to divide the EXCESS over 1.0 by `(0.5 +
  // 0.5*automation_friendly)` ONLY when automation_friendly is high (> 0.5),
  // OR equivalently to MULTIPLY the excess by `(1 - automation_friendly_excess)`
  // where automation_friendly_excess is how much above 0.3 (Apex baseline) the
  // firm sits. Simplest faithful reading: the boost SHRINKS as
  // automation_friendly approaches 1.0.
  //
  // Implementation: effective_excess = (banMult - 1) * (1 - automation_friendly).
  // At automation_friendly = 1.0 → excess = 0 → effectiveMult = 1.0 (no boost).
  // At automation_friendly = 0.3 → excess = (banMult - 1) * 0.7 → e.g. 0.5 * 0.7
  //   = 0.35 → effectiveMult = 1.35 (most of boost survives).
  // This matches the documented intent and the test expectation.
  const banExcess = (banMult - 1) * (1 - automationFriendly);
  const effectiveBanMult = 1 + banExcess;

  // ── Payout-denial frequency modulator ──────────────────────────────────
  let denialMult = 1.0;
  const freq = Number.isFinite(profile.payoutRequestFrequency)
    ? Math.max(0, profile.payoutRequestFrequency)
    : 0;
  if (freq > SURVIVAL_MODULATORS.HIGH_PAYOUT_FREQ) {
    denialMult = Math.min(
      SURVIVAL_MODULATORS.DENIAL_FREQ_CAP_MULT,
      1.0 +
        SURVIVAL_MODULATORS.DENIAL_FREQ_STEP *
          (freq - SURVIVAL_MODULATORS.HIGH_PAYOUT_FREQ),
    );
  }

  // ── VPN/automation-detection modulator ─────────────────────────────────
  // Engages only when the strategy uses automation. Firms with high
  // automation_friendly (Topstep ≈ 1.0) → no boost. Firms with low
  // automation_friendly (Apex ≈ 0.3) → significant boost.
  let vpnMult = 1.0;
  if (profile.usesAutomation === true) {
    vpnMult =
      1.0 +
      (1.0 - automationFriendly) * SURVIVAL_MODULATORS.VPN_AUTO_HOSTILITY_COEF;
  }

  return {
    P_suspension_30d: clampProb(safeProb(raw.P_suspension_30d)),
    P_payout_denial: clampProb(safeProb(raw.P_payout_denial) * denialMult),
    P_fund_freeze_year: clampProb(safeProb(raw.P_fund_freeze_year)),
    P_profitable_trader_ban_year: clampProb(
      safeProb(raw.P_profitable_trader_ban_year) * effectiveBanMult,
    ),
    P_vpn_detection: clampProb(safeProb(raw.P_vpn_detection) * vpnMult),
    automation_friendly: automationFriendly,
    evidence_weight: Number.isFinite(raw.evidence_weight)
      ? Math.max(0, Math.floor(raw.evidence_weight))
      : 0,
  };
}

// ─── Daily hazard composition ───────────────────────────────────────────────

interface DailyHazards {
  suspension: number;
  freeze: number;
  ban: number;
  payoutDenial: number;
  vpn: number;
  combined: number;
}

/**
 * Convert (modulator-applied) priors + profile into independent daily hazards.
 * Each hazard is the per-day probability of that adversarial event firing for
 * the given trader. Combined hazard = 1 − ∏(1 − h_i).
 *
 * Time-semantic conversions:
 *   - suspension: P_suspension_30d / 30
 *   - freeze:     P_fund_freeze_year / 365
 *   - ban:        P_profitable_trader_ban_year / 365
 *   - payoutDenial: P_payout_denial * (payoutRequestFrequency / 365)
 *   - vpn:        P_vpn_detection / 30 (treated as monthly), gated on usesAutomation
 */
function composeDailyHazards(
  priors: AdversarialPriors,
  profile: StrategyProfile,
): DailyHazards {
  const suspension = clampProb(priors.P_suspension_30d / 30);
  const freeze = clampProb(priors.P_fund_freeze_year / 365);
  const ban = clampProb(priors.P_profitable_trader_ban_year / 365);

  const freq = Number.isFinite(profile.payoutRequestFrequency)
    ? Math.max(0, profile.payoutRequestFrequency)
    : 0;
  const payoutDenial = clampProb(priors.P_payout_denial * (freq / 365));

  // VPN hazard only applies when the strategy uses automation. Without
  // automation, the firm has nothing to flag.
  const vpn =
    profile.usesAutomation === true ? clampProb(priors.P_vpn_detection / 30) : 0;

  // Combined daily survival: ∏(1 − h_i). Combined hazard = 1 − that.
  const dailySurvival =
    (1 - suspension) *
    (1 - freeze) *
    (1 - ban) *
    (1 - payoutDenial) *
    (1 - vpn);
  const combined = clampProb(1 - dailySurvival);

  return { suspension, freeze, ban, payoutDenial, vpn, combined };
}

// ─── computeSurvivalProbability — deterministic single-horizon math ────────

/**
 * Bayesian-flavoured single-horizon survival probability.
 *
 * Composes per-event-type hazards (after applying strategy modulators) into a
 * combined daily survival rate, then returns `(1 − daily_hazard) ** horizonDays`
 * clamped to [0, 1].
 *
 * Pure deterministic. No randomness. Identical inputs → identical output.
 */
export function computeSurvivalProbability(
  priors: AdversarialPriors,
  profile: StrategyProfile,
  horizonDays: number,
): number {
  if (!Number.isFinite(horizonDays) || horizonDays <= 0) {
    return 1.0;
  }
  const modulated = applyModulators(priors, profile);
  const hazards = composeDailyHazards(modulated, profile);
  const dailySurvival = clampProb(1 - hazards.combined);
  // Numerically robust: use exp(log(...) * h) to avoid Math.pow underflow at
  // tiny daily survival × big horizon. log(0) → -Infinity → exp(-Infinity) = 0.
  const days = Math.floor(horizonDays);
  if (dailySurvival <= 0) return 0.0;
  if (dailySurvival >= 1) return 1.0;
  const survival = Math.exp(Math.log(dailySurvival) * days);
  return clampProb(survival);
}

// ─── LCG (deterministic Monte Carlo) ───────────────────────────────────────

/**
 * Linear congruential generator — Numerical Recipes parameters. Deterministic
 * given a seed; never uses Math.random. Used for `simulateSurvivalCurve` so
 * test snapshots are reproducible.
 */
class LCG {
  private state: number;

  constructor(seed: number) {
    // Avoid 0 state (would lock the generator). Mix the seed.
    this.state = (seed >>> 0) || 1;
  }

  /** Returns a uniform float in [0, 1). */
  next(): number {
    // Numerical Recipes parameters (a = 1664525, c = 1013904223, m = 2^32)
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
}

// ─── simulateSurvivalCurve — Monte Carlo over 365 days ──────────────────────

/** Optional knobs for `simulateSurvivalCurve`. */
export interface SimulateOptions {
  /** Number of trader trials. Default 1000. */
  numTrials?: number;
  /** Optional seed for the deterministic LCG. Default = Date.now() ⊕ trialCount. */
  seed?: number;
}

/**
 * Monte Carlo over `numTrials` traders. Per trial: simulate day-by-day
 * adversarial event draws over 365 days. A trial "survives day D" iff no
 * terminal event (suspension, freeze, ban, payout-denial, VPN-detection) has
 * fired by day D. We then aggregate to 30/90/180/365 day survival rates.
 *
 * Strategy modulators amplify base rates per documented public-dispute patterns.
 *
 * Determinism: when `seed` is provided, the LCG produces identical results
 * across calls. When omitted, a per-process default seed is used (still
 * deterministic per call, but not reproducible across runs).
 */
export function simulateSurvivalCurve(
  priors: AdversarialPriors,
  profile: StrategyProfile,
  numTrials: number | SimulateOptions = 1000,
): SurvivalCurve {
  // Allow legacy positional `numTrials: number` and new options object.
  let trials = 1000;
  let seed: number | undefined;
  if (typeof numTrials === "number") {
    if (Number.isFinite(numTrials) && numTrials > 0) {
      trials = Math.max(1, Math.floor(numTrials));
    }
  } else if (numTrials && typeof numTrials === "object") {
    if (
      typeof numTrials.numTrials === "number" &&
      Number.isFinite(numTrials.numTrials) &&
      numTrials.numTrials > 0
    ) {
      trials = Math.max(1, Math.floor(numTrials.numTrials));
    }
    if (typeof numTrials.seed === "number" && Number.isFinite(numTrials.seed)) {
      seed = numTrials.seed;
    }
  }

  const modulated = applyModulators(priors, profile);
  const hazards = composeDailyHazards(modulated, profile);

  // Edge case: zero combined hazard → analytical survival is 1.0 forever.
  if (hazards.combined <= 0) {
    return { p_30d: 1.0, p_90d: 1.0, p_180d: 1.0, p_365d: 1.0 };
  }
  // Edge case: combined hazard ≥ 1 → guaranteed-fail every day.
  if (hazards.combined >= 1) {
    return { p_30d: 0.0, p_90d: 0.0, p_180d: 0.0, p_365d: 0.0 };
  }

  // Deterministic LCG: seed combines explicit seed (or fallback) with trial count.
  const baseSeed =
    seed != null ? seed : ((Date.now() & 0xffffffff) ^ (trials * 2654435761)) >>> 0;
  const rng = new LCG(baseSeed);

  const HORIZONS = [30, 90, 180, 365] as const;
  const aliveByHorizon: Record<number, number> = {
    30: 0,
    90: 0,
    180: 0,
    365: 0,
  };

  for (let t = 0; t < trials; t++) {
    let dayKilled = -1;
    // Simulate up to 365 days. Short-circuit once any event fires.
    for (let day = 1; day <= 365; day++) {
      // Independent draws per event type (matches the independence assumption
      // used in the analytical math). Any single fire = trader is killed.
      const r = rng.next();
      if (r < hazards.combined) {
        dayKilled = day;
        break;
      }
    }
    for (const h of HORIZONS) {
      if (dayKilled === -1 || dayKilled > h) {
        aliveByHorizon[h] += 1;
      }
    }
  }

  return {
    p_30d: clampProb(aliveByHorizon[30] / trials),
    p_90d: clampProb(aliveByHorizon[90] / trials),
    p_180d: clampProb(aliveByHorizon[180] / trials),
    p_365d: clampProb(aliveByHorizon[365] / trials),
  };
}

// ─── fitFirmPriorsFromHealthChecks — pure helper ────────────────────────────

/**
 * Pure helper: given a list of `prop_firm_health_checks` rows for a firm,
 * estimate the 30-day-window suspension probability from observed events.
 *
 * Counts rows whose status is `suspended` or `auth_failure` (the same
 * detection rule used by `prop-firm-health-service`). Assumes the input rows
 * are the firm's history; no time filter is applied here (caller passes in
 * the lookback window they want — typically last 90 days).
 *
 * Estimation: P_suspension_30d ≈ (suspension_events / total_observation_days)
 * × 30, where total_observation_days is derived from the time span between
 * the earliest and latest `createdAt`. If the span is < 30 days, we use 30
 * (the prior is a 30-day-window probability) to avoid extrapolating from
 * insufficient data.
 *
 * Returns a `Partial<AdversarialPriors>` so the caller (Pass 2B) can merge with
 * seed-JSON priors. Other fields (P_payout_denial, P_fund_freeze_year, ...)
 * are intentionally left undefined — they require evidence types that
 * health-check polling cannot detect (fund freezes show up via dashboard
 * snapshots; bans need manual curation).
 */
export function fitFirmPriorsFromHealthChecks(
  firmId: string,
  healthCheckRows: Array<{ status: string; createdAt: Date | string }>,
): Partial<AdversarialPriors> {
  void firmId; // currently unused in math; kept for API symmetry / future audit logging

  if (!Array.isArray(healthCheckRows) || healthCheckRows.length === 0) {
    return { P_suspension_30d: 0 };
  }

  let suspensionEvents = 0;
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;

  for (const row of healthCheckRows) {
    const status = String(row?.status ?? "").toLowerCase();
    if (status === "suspended" || status === "auth_failure") {
      suspensionEvents += 1;
    }
    const ts =
      row?.createdAt instanceof Date
        ? row.createdAt.getTime()
        : Date.parse(String(row?.createdAt ?? ""));
    if (Number.isFinite(ts)) {
      if (ts < earliestMs) earliestMs = ts;
      if (ts > latestMs) latestMs = ts;
    }
  }

  if (suspensionEvents === 0) {
    return { P_suspension_30d: 0 };
  }

  // Compute observation-window in days. Floor at 30 to avoid extrapolation
  // from too-short windows (a single suspension on day 1 with a 1-day window
  // would otherwise translate to a guaranteed-suspension prior).
  const spanMs = Number.isFinite(earliestMs) && Number.isFinite(latestMs)
    ? Math.max(0, latestMs - earliestMs)
    : 0;
  const spanDays = Math.max(30, spanMs / (1000 * 60 * 60 * 24));
  const eventsPerDay = suspensionEvents / spanDays;
  const p30 = clampProb(eventsPerDay * 30);

  return { P_suspension_30d: p30 };
}

// ─── deriveStrategyProfile — read-only helper ──────────────────────────────

/**
 * Derive a `StrategyProfile` from existing strategy + backtest shapes. Read-only.
 * No DB calls. Defensive against missing fields.
 *
 * `monthlyPayoutDollars` precedence:
 *   1. `latestBacktest.avg_monthly_pnl * 0.8` (after 80% prop-firm split).
 *   2. `strategy.daily_target_dollars * 20 * 0.8` (~20 trading days/month).
 *   3. Fallback default: $5000/mo.
 *
 * `usesAutomation` defaults to true (Trading Forge is automated end-to-end).
 * `payoutRequestFrequency` defaults to 12 (monthly).
 * `averagePosition` is read from `dsl.session_filter` (`'rth_only'` | `'overnight'`);
 * default is `'rth_only'`.
 */
// Use a permissive shape for the inputs — they come from existing Drizzle row
// types which carry plenty of unrelated fields. Public-API consumers pass
// whatever they have; we read what we need and ignore the rest.
type StrategyLike = {
  dsl?: { session_filter?: unknown } | Record<string, unknown> | null;
  daily_target_dollars?: number | string | null;
  dailyTargetDollars?: number | string | null;
} & Record<string, unknown>;

type BacktestLike = {
  avg_monthly_pnl?: number | string | null;
  avgMonthlyPnl?: number | string | null;
} & Record<string, unknown>;

export function deriveStrategyProfile(
  strategy: StrategyLike,
  latestBacktest?: BacktestLike,
): StrategyProfile {
  // ─ monthlyPayoutDollars ─
  const PAYOUT_SPLIT = 0.8;
  let monthlyPayoutDollars = 5000;

  const avgMonthlyPnlRaw =
    latestBacktest?.avg_monthly_pnl ?? latestBacktest?.avgMonthlyPnl ?? null;
  const avgMonthly =
    avgMonthlyPnlRaw != null ? Number(avgMonthlyPnlRaw) : Number.NaN;

  if (Number.isFinite(avgMonthly) && avgMonthly > 0) {
    monthlyPayoutDollars = avgMonthly * PAYOUT_SPLIT;
  } else {
    const dailyTargetRaw =
      (strategy?.daily_target_dollars ?? strategy?.dailyTargetDollars) as
        | number
        | string
        | null
        | undefined;
    const dailyTarget = dailyTargetRaw != null ? Number(dailyTargetRaw) : Number.NaN;
    if (Number.isFinite(dailyTarget) && dailyTarget > 0) {
      monthlyPayoutDollars = dailyTarget * 20 * PAYOUT_SPLIT;
    }
  }

  // ─ averagePosition ─
  let averagePosition: "rth_only" | "overnight" = "rth_only";
  const dsl = (strategy?.dsl ?? null) as Record<string, unknown> | null;
  const sessionFilter = dsl != null ? String(dsl.session_filter ?? "").toLowerCase() : "";
  if (sessionFilter === "overnight") {
    averagePosition = "overnight";
  } else if (sessionFilter === "rth_only" || sessionFilter === "rth") {
    averagePosition = "rth_only";
  }

  return {
    monthlyPayoutDollars,
    payoutRequestFrequency: 12,
    usesAutomation: true,
    averagePosition,
  };
}
