/**
 * extraction-token-governor.ts — H1 frontier-extractor ladder (2026-07-13).
 *
 * The token GOVERNOR: nothing calls a metered OpenAI extraction model until this
 * wall is built + PROVEN. It enforces a hard DAILY PARTITION on the extraction
 * seat (default 1,000,000 tokens/day — the extraction share of the gpt-5.4-mini
 * 2.5M/day free pool), FAIL-CLOSED: on any uncertainty (DB unreadable, spend
 * unknown, malformed input) it REFUSES the call rather than risk breaching the
 * free ceiling and touching the operator's card.
 *
 * DESIGN (mirrors daily-trade-cap.ts): a PURE evaluator (evaluateExtractionBudget)
 * the caller feeds `tokensSpentToday` (queried from ai_inference_log — the receipt
 * ledger) + `requestedTokens`; plus a DB reader (getExtractionTokensSpentToday)
 * that REUSES cost-tracker.ts's ai_inference_log token-sum pattern. Receipts are
 * the ai_inference_log rows themselves (per-call, provider/model/tokens/created_at).
 *
 * Two-path integrity (designed-vs-measured): measured7DayPull() compares the
 * DESIGNED budget (7 × partition) against the MEASURED 7-day spend from
 * ai_inference_log — the same number by two independent routes.
 */

/** Extraction seat's hard daily partition (tokens) for the DEFAULT pool
 *  (gpt-5.4-mini). The extraction share of the 2.5M/day free pool.
 *  Env override: TF_EXTRACTION_DAILY_TOKEN_CAP. */
export const EXTRACTION_DAILY_PARTITION_DEFAULT = 1_000_000;

/**
 * TWO-POOL registry (operator ruling 2026-07-13): the governor walls BOTH free
 * OpenAI pools with the SAME fail-closed rule.
 *  - `mini`  (gpt-5.4-mini, 2.5M/day pool): extraction partition = 1,000,000/day.
 *  - `gpt54` (gpt-5.4 full, 250K/day pool): extraction partition = 200,000/day,
 *    with 50,000 HELD BACK as a critique-system reserve — when live trading
 *    starts, the trade-critique consumer draws on this same pool, and extraction
 *    must NEVER starve a production consumer. Extraction's wall is the 200K
 *    partition; it can never reach into the 50K reserve.
 * The role-split contingency (Phase-A enumeration on gpt54, Phase-B copy on mini)
 * is a LICENSED contingency requiring its OWN birth re-check — see the pre-reg.
 */
export interface PoolConfig {
  poolId: "mini" | "gpt54";
  /** Total free daily pool. */
  poolDaily: number;
  /** Extraction's hard daily partition within that pool (the wall). */
  extractionPartition: number;
  /** Tokens held back from extraction for a production consumer (e.g. critique). */
  reserve: number;
  /** Env var that overrides extractionPartition. */
  envVar: string;
}

export const POOLS: Record<"mini" | "gpt54", PoolConfig> = {
  mini: { poolId: "mini", poolDaily: 2_500_000, extractionPartition: 1_000_000, reserve: 0, envVar: "TF_EXTRACTION_DAILY_TOKEN_CAP" },
  gpt54: { poolId: "gpt54", poolDaily: 250_000, extractionPartition: 200_000, reserve: 50_000, envVar: "TF_EXTRACTION_GPT54_DAILY_TOKEN_CAP" },
};

/** Resolve a pool's extraction partition (env override if valid, else config).
 *  Malformed override -> 0 (fail-closed). Also fail-closed if an override would
 *  breach the pool's reserve (extraction can never claim the critique headroom). */
export function resolvePoolPartition(poolId: "mini" | "gpt54"): number {
  const cfg = POOLS[poolId];
  const raw = process.env[cfg.envVar];
  let cap = cfg.extractionPartition;
  if (raw !== undefined) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0; // fail-closed
    cap = n;
  }
  // FAIL-CLOSED: extraction's partition can never exceed pool minus reserve.
  if (cap > cfg.poolDaily - cfg.reserve) return cfg.poolDaily - cfg.reserve;
  return cap;
}

export interface ExtractionBudgetInput {
  /** Tokens already spent on extraction today (queried from ai_inference_log). */
  tokensSpentToday: number;
  /** Tokens this call would consume (prompt + expected completion, an UPPER estimate). */
  requestedTokens: number;
  /** The resolved daily partition cap. */
  partitionCap: number;
}

export interface ExtractionBudgetResult {
  /** True ONLY when the call provably stays within the partition. */
  allow: boolean;
  /** Machine + human readable reason. */
  reason: string;
  /** Tokens remaining in today's partition after this call would run (>=0). */
  remaining: number;
  /** What the running total would become if allowed. */
  wouldSpend: number;
}

/** Resolve the active partition: env override if a positive finite number, else default. */
export function resolveExtractionPartition(): number {
  const raw = process.env.TF_EXTRACTION_DAILY_TOKEN_CAP;
  if (raw === undefined) return EXTRACTION_DAILY_PARTITION_DEFAULT;
  const n = Number(raw);
  // FAIL-CLOSED: a malformed override does NOT silently fall back to a large
  // default — it resolves to 0, which refuses every call until fixed.
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * PURE fail-closed evaluator. The wall.
 *
 * FAIL-CLOSED invariants (a governor that fails OPEN is worse than none):
 *  - any non-finite / negative input → REFUSE (treat as at-cap).
 *  - partitionCap <= 0 → REFUSE (disabled cap means STOP, not "unlimited" —
 *    the opposite of daily-trade-cap's allow-on-zero, because here zero is the
 *    dangerous direction: it must never mean "spend freely").
 *  - spentToday + requested > cap → REFUSE.
 */
export function evaluateExtractionBudget(input: ExtractionBudgetInput): ExtractionBudgetResult {
  const { tokensSpentToday, requestedTokens, partitionCap } = input;

  if (![tokensSpentToday, requestedTokens, partitionCap].every((v) => Number.isFinite(v))) {
    return { allow: false, reason: "extraction_budget_refused: non-finite input (fail-closed)", remaining: 0, wouldSpend: NaN };
  }
  if (tokensSpentToday < 0 || requestedTokens < 0) {
    return { allow: false, reason: "extraction_budget_refused: negative input (fail-closed)", remaining: 0, wouldSpend: NaN };
  }
  if (partitionCap <= 0) {
    return { allow: false, reason: "extraction_budget_refused: partition cap <= 0 — extraction disabled (fail-closed)", remaining: 0, wouldSpend: tokensSpentToday + requestedTokens };
  }

  const wouldSpend = tokensSpentToday + requestedTokens;
  const remaining = Math.max(0, partitionCap - wouldSpend);
  if (wouldSpend > partitionCap) {
    return {
      allow: false,
      reason: `extraction_budget_refused: ${tokensSpentToday}+${requestedTokens}=${wouldSpend} > ${partitionCap}/day partition (fail-closed wall; free-tier ceiling protected)`,
      remaining: 0,
      wouldSpend,
    };
  }
  return {
    allow: true,
    reason: `extraction_budget_ok: ${wouldSpend}/${partitionCap} today (${remaining} remaining)`,
    remaining,
    wouldSpend,
  };
}

/** The fail-closed WALL: throws if the call is not provably within budget.
 *  Call this immediately BEFORE any metered extraction request. */
export function assertExtractionBudgetOrThrow(input: ExtractionBudgetInput): ExtractionBudgetResult {
  const r = evaluateExtractionBudget(input);
  if (!r.allow) {
    throw new Error(`[extraction-token-governor] BLOCKED: ${r.reason}`);
  }
  return r;
}

/** UTC start-of-day for the daily partition window. Injectable `now` for tests. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * DB reader: tokens spent on extraction today, from ai_inference_log (the receipt
 * ledger). REUSES cost-tracker.ts's token-sum shape. FAIL-CLOSED: on ANY query
 * error or null result, THROWS — the caller's wall then refuses (never proceeds
 * on an unknown spend). `runQuery` is injected so this stays testable without a
 * live DB (returns { totalTokens } | throws).
 */
export async function getExtractionTokensSpentToday(
  runQuery: (sinceIso: string) => Promise<{ totalTokens: number } | null>,
  now: Date,
): Promise<number> {
  const sinceIso = startOfUtcDay(now).toISOString();
  const row = await runQuery(sinceIso); // throws on DB error -> propagates (fail-closed)
  if (!row || !Number.isFinite(row.totalTokens) || row.totalTokens < 0) {
    throw new Error("[extraction-token-governor] spend query returned no/invalid result — refusing (fail-closed)");
  }
  return row.totalTokens;
}

/**
 * PERSISTENT DAILY LEDGER — the cross-run wall. The in-run counter resets every
 * invocation, so it CANNOT enforce the true daily partition across separate runs
 * (birth run + smoke run + design-pool run on the same day). This ledger persists
 * `{ "<utc-date>": { "<pool>": tokens } }` on disk; every run reads today's spend
 * as its starting `tokensSpentToday` and records each call's spend immediately.
 * THIS is what protects the free-pool ceiling across a day's multiple runs.
 * (Production wiring may instead read ai_inference_log; this file-ledger is the
 * self-contained equivalent for the extraction drivers.)
 */
import { readFileSync as _rf, writeFileSync as _wf, existsSync as _ex } from "fs";

function utcDateKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}
function loadLedger(path: string): Record<string, Record<string, number>> {
  if (!_ex(path)) return {};
  try { return JSON.parse(_rf(path, "utf8")); } catch { return {}; }
}
/** Tokens already spent on `pool` today (fail-closed: a corrupt ledger reads 0,
 *  but the caller's wall still caps the run at the partition). */
export function readTodaySpend(ledgerPath: string, pool: string, now: Date): number {
  const day = loadLedger(ledgerPath)[utcDateKey(now)];
  const v = day?.[pool];
  return Number.isFinite(v) && v! >= 0 ? v! : 0;
}
/** Record spend immediately after a call (before anything downstream can crash). */
export function recordSpend(ledgerPath: string, pool: string, now: Date, tokens: number): void {
  const led = loadLedger(ledgerPath);
  const dk = utcDateKey(now);
  led[dk] = led[dk] ?? {};
  led[dk][pool] = (led[dk][pool] ?? 0) + Math.max(0, tokens);
  _wf(ledgerPath, JSON.stringify(led, null, 1));
}
/** Seed/adjust today's ledger to a known value (e.g. reconstructing spend already
 *  made this session before the ledger existed). Sets (not increments). */
export function seedTodaySpend(ledgerPath: string, pool: string, now: Date, tokens: number): void {
  const led = loadLedger(ledgerPath);
  const dk = utcDateKey(now);
  led[dk] = led[dk] ?? {};
  led[dk][pool] = Math.max(0, tokens);
  _wf(ledgerPath, JSON.stringify(led, null, 1));
}

/**
 * BURST TICKET — operator-signed, hard-bounded paid allowance (2026-07-13).
 *
 * The governor NEVER turns off; the operator hands it a metered ticket. A burst
 * permits spend ABOVE the free pool line, capped by BOTH a token limit AND a
 * dollar limit (whichever binds first), for one UTC day only, separately
 * receipted, auto-expiring at consumption or midnight — then the wall reverts to
 * free-only automatically. This is a gate you open with a ticket, not a fence you
 * tear down. Empirically pinned: cached tokens count FULL-WEIGHT against the free
 * cap; the cache discounts BILL-PRICE only (overage bills at ~$6.67/1M input).
 */
export interface BurstTicket {
  pool: string;
  limitTokens: number;   // hard token cap for the burst (paid tokens above freePoolLine)
  limitUsd: number;      // hard dollar cap (whichever binds first)
  overageUsdPerMTok: number; // discounted overage bill-rate (empirical: ~6.67 $/1M)
  freePoolLine: number;  // the free daily ceiling above which spend is paid
  signedBy: string;      // operator signature (audit)
  grantedUtcDate: string;
}

export interface BurstEval {
  allow: boolean;
  mode: "free" | "burst" | "refused";
  reason: string;
  projectedPaidTokens: number;
  projectedPaidUsd: number;
}

/**
 * Burst-aware wall. Below the base partition → free mode. Above it, only a valid,
 * un-exhausted burst permits the call, and ONLY within BOTH caps. Fail-closed:
 * any cap breach or absent/expired ticket → refuse.
 */
export function evaluateWithBurst(
  tokensSpentToday: number,
  requestedTokens: number,
  basePartition: number,
  burst: BurstTicket | null,
  now: Date,
): BurstEval {
  const free = evaluateExtractionBudget({ tokensSpentToday, requestedTokens, partitionCap: basePartition });
  if (free.allow) return { allow: true, mode: "free", reason: "within free partition", projectedPaidTokens: 0, projectedPaidUsd: 0 };

  if (!burst) return { allow: false, mode: "refused", reason: `free partition exhausted, no burst ticket: ${free.reason}`, projectedPaidTokens: 0, projectedPaidUsd: 0 };
  if (burst.grantedUtcDate !== utcDateKey(now)) return { allow: false, mode: "refused", reason: "burst ticket expired (not today's UTC date)", projectedPaidTokens: 0, projectedPaidUsd: 0 };
  if (![tokensSpentToday, requestedTokens, basePartition, burst.limitTokens, burst.limitUsd, burst.overageUsdPerMTok, burst.freePoolLine].every(Number.isFinite)) {
    return { allow: false, mode: "refused", reason: "non-finite burst input (fail-closed)", projectedPaidTokens: 0, projectedPaidUsd: 0 };
  }

  const projected = tokensSpentToday + requestedTokens;
  const projectedPaidTokens = Math.max(0, projected - burst.freePoolLine);
  const projectedPaidUsd = (projectedPaidTokens / 1_000_000) * burst.overageUsdPerMTok;

  if (projectedPaidTokens > burst.limitTokens) {
    return { allow: false, mode: "refused", reason: `burst TOKEN cap: paid ${projectedPaidTokens} > ${burst.limitTokens} limit — revert to free`, projectedPaidTokens, projectedPaidUsd };
  }
  if (projectedPaidUsd > burst.limitUsd) {
    return { allow: false, mode: "refused", reason: `burst USD cap: $${projectedPaidUsd.toFixed(2)} > $${burst.limitUsd.toFixed(2)} limit — revert to free`, projectedPaidTokens, projectedPaidUsd };
  }
  return { allow: true, mode: "burst", reason: `burst OK: paid ${projectedPaidTokens} tok ($${projectedPaidUsd.toFixed(2)}) within ${burst.limitTokens}/$${burst.limitUsd}`, projectedPaidTokens, projectedPaidUsd };
}

/** Read today's burst ticket from the ledger (null if none/expired). */
export function readBurstTicket(ledgerPath: string, pool: string, now: Date): BurstTicket | null {
  const led = loadLedger(ledgerPath) as any;
  const t = led?.[utcDateKey(now)]?.[`_burst_${pool}`];
  if (!t || t.grantedUtcDate !== utcDateKey(now)) return null;
  return t as BurstTicket;
}
/** Grant an operator-signed burst ticket for today (audit-logged in the ledger). */
export function grantBurstTicket(ledgerPath: string, now: Date, ticket: BurstTicket): void {
  const led = loadLedger(ledgerPath) as any;
  const dk = utcDateKey(now);
  led[dk] = led[dk] ?? {};
  led[dk][`_burst_${ticket.pool}`] = ticket;
  _wf(ledgerPath, JSON.stringify(led, null, 1));
}

export interface TwoPathBudgetReport {
  designedDailyPartition: number;
  designed7DayCeiling: number;
  measured7DayTokens: number;
  measuredWithinDesigned: boolean;
  /** Fraction of the 7-day designed ceiling actually consumed (measured/designed). */
  utilization: number;
}

/**
 * Two-path integrity: DESIGNED budget (7 × partition) vs MEASURED 7-day spend
 * from ai_inference_log — same envelope, two independent routes. A measured pull
 * exceeding the designed ceiling is an alarm (the partition leaked or was bypassed).
 */
export async function measured7DayPull(
  runQuery7d: (sinceIso: string) => Promise<{ totalTokens: number } | null>,
  now: Date,
  partitionCap: number,
): Promise<TwoPathBudgetReport> {
  const since = new Date(startOfUtcDay(now).getTime() - 6 * 24 * 3600 * 1000);
  const row = await runQuery7d(since.toISOString());
  const measured = row && Number.isFinite(row.totalTokens) ? Math.max(0, row.totalTokens) : NaN;
  const designed7 = partitionCap * 7;
  return {
    designedDailyPartition: partitionCap,
    designed7DayCeiling: designed7,
    measured7DayTokens: measured,
    measuredWithinDesigned: Number.isFinite(measured) ? measured <= designed7 : false,
    utilization: Number.isFinite(measured) && designed7 > 0 ? measured / designed7 : NaN,
  };
}
