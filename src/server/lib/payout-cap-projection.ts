/**
 * Payout-cap projection helpers (W3B 2026-07-17).
 *
 * The prop-firm ROI/payout projection endpoints previously computed
 * `monthlyNet = monthlyGross × payoutSplit` UNCAPPED — but firms cap payouts
 * PER WITHDRAWAL REQUEST (`getPayoutCap()` in src/shared/firm-config.ts).
 * These helpers convert the per-request cap into a monthly ceiling using a
 * PINNED requests-per-month assumption, and stamp that assumption into the
 * response payload so consumers can see exactly what was assumed.
 *
 * PINNED cadence (W3B):
 *   - MFFU:    2 requests/month (bi-weekly payouts per CLAUDE.md §6; the
 *              Builder plan can pay every 48h after the buffer clears —
 *              2/month is the conservative pinned default).
 *   - Topstep: 1 request/month (default cadence).
 *
 * HONEST SIMPLIFICATIONS (not modeled here — future account-twin work):
 *   - No account-stage lifecycle (XFA → LFA transition after 5 payouts etc.);
 *     the caller picks ONE stage for the whole projection window.
 *   - No per-cycle buffer/qualifying-day modeling inside a month.
 *   - Cap is applied as a flat monthly ceiling
 *     (cap_per_request × requests_per_month × numAccounts).
 */

import { getPayoutCap } from "../../shared/firm-config.js";

/** Pinned payout-request cadence per month per firm (see module doc). */
export const PAYOUT_REQUESTS_PER_MONTH: Readonly<Record<string, number>> = {
  mffu: 2, // bi-weekly per CLAUDE.md §6
  topstep: 1, // monthly default
} as const;

export interface PayoutCapContext {
  /** Per-request cap in USD, or null = uncapped (Topstep LFA). */
  cap_per_request: number | null;
  /** Pinned withdrawal requests per month for this firm. */
  requests_per_month: number;
  /** cap_per_request × requests_per_month (per account), or null = uncapped. */
  monthly_cap_per_account: number | null;
  account_stage: "xfa" | "lfa";
  payout_path: "standard" | "consistency";
  dll_opted_in: boolean;
  source: "getPayoutCap";
  /** Honest labels for what this projection does NOT model. */
  simplifications: string[];
}

/**
 * Resolve the payout-cap context for a firm/stage/path/DLL combination.
 *
 * dllOptedIn default TRUE mirrors the operator reality: broker_accounts.
 * dll_opted_in is NOT NULL DEFAULT true since migration 0168.
 */
export function resolvePayoutCapContext(
  firmId: string,
  accountStage: "xfa" | "lfa" = "xfa",
  payoutPath: "standard" | "consistency" = "standard",
  dllOptedIn: boolean = true,
): PayoutCapContext {
  const firmKey = firmId.toLowerCase();
  const capPerRequest = getPayoutCap(firmKey, accountStage, payoutPath, dllOptedIn);
  const requestsPerMonth = PAYOUT_REQUESTS_PER_MONTH[firmKey] ?? 1;

  return {
    cap_per_request: capPerRequest,
    requests_per_month: requestsPerMonth,
    monthly_cap_per_account:
      capPerRequest === null ? null : capPerRequest * requestsPerMonth,
    account_stage: accountStage,
    payout_path: payoutPath,
    dll_opted_in: dllOptedIn,
    source: "getPayoutCap",
    simplifications: [
      "no account-stage lifecycle modeling (XFA→LFA transition) — single stage for the whole window (future account-twin)",
      "no per-cycle buffer/qualifying-day modeling inside a month",
      "cap applied as flat monthly ceiling = cap_per_request × requests_per_month × numAccounts",
      firmKey === "mffu"
        ? "MFFU pinned at 2 requests/month (bi-weekly per CLAUDE.md §6; Builder can pay faster after buffer — conservative)"
        : "Topstep pinned at 1 request/month (default cadence)",
    ],
  };
}

/**
 * Cap an uncapped projected monthly net payout at the firm's monthly ceiling.
 * Returns the input unchanged when the tier is uncapped (Topstep LFA → null cap).
 */
export function applyMonthlyPayoutCap(
  uncappedMonthlyNet: number,
  ctx: PayoutCapContext,
  numAccounts: number = 1,
): number {
  if (ctx.monthly_cap_per_account === null) return uncappedMonthlyNet;
  return Math.min(uncappedMonthlyNet, ctx.monthly_cap_per_account * numAccounts);
}
