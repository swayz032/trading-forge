import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface Firm {
  name: string;
  displayName: string;
  evaluationType: string;
  accountTypes: string[];
}

interface FirmAccountConfig {
  accountSize: number;
  monthlyFee: number;
  activationFee: number;
  ongoingMonthlyFee: number;
  profitTarget: number;
  maxDrawdown: number;
  maxContracts: number;
  trailing: string;
  payoutSplit: number;
  minPayoutDays: number;
  consistencyRule: number | null;
  dailyLossLimit: number | null;
  overnightOk: boolean;
  weekendOk: boolean;
}

export interface FirmAccountDetail {
  firm: string;
  displayName: string;
  evaluationType: string;
  accountType: string;
  config: FirmAccountConfig;
  bufferAmount: number;
  totalHurdle: number;
}

interface FirmRanking {
  firm: string;
  displayName: string;
  accountType: string;
  passes: boolean;
  violations: string[];
  evalDays: number;
  bufferDays: number;
  totalDaysToFirstPayout: number;
  evalMonths: number;
  bufferMonths: number;
  totalEvalCost: number;
  ongoingMonthlyFee: number;
  bufferOngoingFees: number;
  monthlyGross: number;
  monthlyNet: number;
  payoutSplit: number;
  fundedPayoutMonths: number;
  totalPayouts: number;
  totalCosts: number;
  roi: number;
  annualizedRoi: number;
  trailing: string;
  maxDrawdown: number;
  maxContracts: number;
  // B14 Survival Twin advisory fields (Phase 0). The backend does NOT yet
  // populate these on the /prop-firm/rank response — they are OPTIONAL so the
  // survival-first UI compiles and renders honest "—" / "unavailable" empty
  // states until the survival API lands. Never fabricated client-side.
  survivalProbability?: number | null;
  survivalCurve?: SurvivalCurve | null;
  evidenceWeight?: number | null;
}

/** 6-month survival probability sampled at fixed horizons. Optional/advisory —
 *  populated only when the backend B14 survival API is wired (not yet). */
export interface SurvivalCurve {
  p_30d: number;
  p_90d: number;
  p_180d: number;
  p_365d: number;
}

interface RankingResponse {
  strategy: { avgDailyPnl: number; maxDrawdown: number; winRate: number; profitFactor: number };
  projectionMonths: number;
  rankings: FirmRanking[];
  bestFirm: string | null;
}

interface PayoutMonth {
  month: number;
  phase: "evaluation" | "buffer" | "funded";
  grossPnl: number;
  netPayout: number;
  costs: number;
  cumulativePayout: number;
  cumulativeCost: number;
  cumulativeProfit: number;
}

interface PayoutResponse {
  firm: string;
  accountType: string;
  numAccounts: number;
  avgDailyPnl: number;
  payoutSplit: number;
  ongoingMonthlyFee: number;
  evalMonths: number;
  bufferMonths: number;
  totalPrePayoutMonths: number;
  breakEvenMonth: number | null;
  totalPayout: number;
  totalCosts: number;
  totalProfit: number;
  monthlyProjection: PayoutMonth[];
}

interface TimelineEstimate {
  evalDays: number;
  bufferDays: number;
  totalDays: number;
  calendarDays: number;
  description: string;
}

interface TimelineResponse {
  firm: string;
  accountType: string;
  profitTarget: number;
  maxDrawdown: number;
  strategyMaxDrawdown: number;
  survives: boolean;
  bufferAmount: number;
  totalHurdle: number;
  timeline: {
    optimistic: TimelineEstimate;
    realistic: TimelineEstimate;
    conservative: TimelineEstimate;
  };
  minPayoutDays: number;
  monthlyFee: number;
  ongoingMonthlyFee: number;
  estimatedEvalCost: number;
}

interface SimulateResult {
  firm: string;
  displayName: string;
  accountType: string;
  passes: boolean;
  violations: string[];
  evalDays: number;
  bufferDays: number;
  evalCost: number;
  ongoingMonthlyFee: number;
  monthlyNet: number;
  fundedPayoutMonths: number;
  annualProfit: number;
  roi: number;
  // B14 Survival Twin advisory field (Phase 0). Optional — backend does not yet
  // populate it on /prop-firm/simulate; PropFirmSimCard renders the legacy
  // verdict pill when null. Never fabricated client-side.
  survivalProbability?: number | null;
}

interface SimulateResponse {
  backtestId: string;
  strategyId: string;
  metrics: { avgDailyPnl: number; maxDrawdown: number; winRate: number; profitFactor: number };
  results: SimulateResult[];
  bestFirm: SimulateResult | null;
}

export type { Firm, FirmRanking, RankingResponse, PayoutMonth, PayoutResponse, TimelineResponse, SimulateResult, SimulateResponse, FirmAccountDetail };

/** StatusBadge variant union (mirrors src/components/forge/StatusBadge.tsx). */
type SurvivalBadgeVariant = "profit" | "amber" | "loss";

/**
 * Map a 6-month survival probability ∈ [0,1] to a StatusBadge verdict variant.
 * Pure presentation helper — it formats whatever probability it is GIVEN and
 * never invents data. Callers guard with `!= null` before invoking, so a missing
 * (undefined/null) survival probability is rendered as an honest "—" upstream,
 * never passed here. Thresholds: ≥70% healthy (profit), ≥50% caution (amber),
 * else danger (loss).
 */
export function survivalVerdict(p: number): SurvivalBadgeVariant {
  if (p >= 0.7) return "profit";
  if (p >= 0.5) return "amber";
  return "loss";
}

/**
 * Format a survival probability ∈ [0,1] as a whole-percent string ("83%").
 * Pure presentation helper — no fabrication; clamps to [0,1] for display safety.
 */
export function formatSurvivalPct(p: number): string {
  const clamped = Math.max(0, Math.min(1, p));
  return `${Math.round(clamped * 100)}%`;
}

export function useFirms() {
  return useQuery<Firm[]>({
    queryKey: ["prop-firm", "firms"],
    queryFn: () => api.get<Firm[]>("/prop-firm/firms"),
  });
}

export function useAllFirmAccounts() {
  const { data: firms } = useFirms();
  return useQuery<FirmAccountDetail[]>({
    queryKey: ["prop-firm", "all-accounts"],
    queryFn: async () => {
      if (!firms?.length) return [];
      const results = await Promise.all(
        firms.map((f) => api.get<FirmAccountDetail>(`/prop-firm/firms/${f.name}/50k`))
      );
      return results;
    },
    enabled: !!firms?.length,
  });
}

export function useFirmAccount(firmName: string, _accountType: string = "50k") {
  // All firms are 50K only — accountType param kept for backward compat
  return useQuery<FirmAccountDetail>({
    queryKey: ["prop-firm", "account", firmName, "50k"],
    queryFn: () => api.get<FirmAccountDetail>(`/prop-firm/firms/${firmName}/50k`),
    enabled: !!firmName,
  });
}

export function useRankFirms() {
  return useMutation<RankingResponse, Error, {
    avgDailyPnl: number;
    maxDrawdown: number;
    winRate: number;
    profitFactor: number;
    holdsOvernight?: boolean;
    bestDayPct?: number;
    months?: number;
  }>({
    mutationFn: (params) => api.post<RankingResponse>("/prop-firm/rank", params),
  });
}

export function usePayoutProjection() {
  return useMutation<PayoutResponse, Error, {
    firm: string;
    avgDailyPnl: number;
    numAccounts?: number;
    months?: number;
  }>({
    mutationFn: (params) => api.post<PayoutResponse>("/prop-firm/payout", params),
  });
}

export function useEvalTimeline() {
  return useMutation<TimelineResponse, Error, {
    firm: string;
    avgDailyPnl: number;
    winRate: number;
    maxDrawdown: number;
  }>({
    mutationFn: (params) => api.post<TimelineResponse>("/prop-firm/timeline", params),
  });
}

export function useSimulateBacktest(backtestId: string | undefined) {
  return useQuery<SimulateResponse>({
    queryKey: ["prop-firm", "simulate", backtestId],
    queryFn: () => api.get<SimulateResponse>(`/prop-firm/simulate/${backtestId}`),
    enabled: !!backtestId,
  });
}
