import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

interface Firm {
  name: string;
  displayName: string;
  accountTypes: string[];
}

interface FirmRanking {
  firm: string;
  displayName: string;
  accountType: string;
  passes: boolean;
  violations: string[];
  evalDays: number;
  evalMonths: number;
  totalEvalCost: number;
  monthlyGross: number;
  monthlyNet: number;
  payoutSplit: number;
  totalPayouts: number;
  roi: number;
  annualizedRoi: number;
  trailing: string;
  maxDrawdown: number;
  maxContracts: number;
}

interface RankingResponse {
  strategy: { avgDailyPnl: number; maxDrawdown: number; winRate: number; profitFactor: number };
  projectionMonths: number;
  rankings: FirmRanking[];
  bestFirm: string | null;
}

interface PayoutMonth {
  month: number;
  phase: "evaluation" | "funded";
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
  evalMonths: number;
  breakEvenMonth: number | null;
  totalPayout: number;
  totalCosts: number;
  totalProfit: number;
  monthlyProjection: PayoutMonth[];
}

interface TimelineEstimate {
  tradingDays: number;
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
  timeline: {
    optimistic: TimelineEstimate;
    realistic: TimelineEstimate;
    conservative: TimelineEstimate;
  };
  minPayoutDays: number;
  monthlyFee: number;
  estimatedEvalCost: number;
}

interface SimulateResult {
  firm: string;
  displayName: string;
  accountType: string;
  passes: boolean;
  violations: string[];
  evalDays: number;
  evalCost: number;
  monthlyNet: number;
  annualProfit: number;
  roi: number;
}

interface SimulateResponse {
  backtestId: string;
  strategyId: string;
  metrics: { avgDailyPnl: number; maxDrawdown: number; winRate: number; profitFactor: number };
  results: SimulateResult[];
  bestFirm: SimulateResult | null;
}

export type { Firm, FirmRanking, RankingResponse, PayoutMonth, PayoutResponse, TimelineResponse, SimulateResult, SimulateResponse };

export function useFirms() {
  return useQuery<Firm[]>({
    queryKey: ["prop-firm", "firms"],
    queryFn: () => api.get<Firm[]>("/prop-firm/firms"),
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
    accountType?: string;
    months?: number;
  }>({
    mutationFn: (params) => api.post<RankingResponse>("/prop-firm/rank", params),
  });
}

export function usePayoutProjection() {
  return useMutation<PayoutResponse, Error, {
    firm: string;
    accountType?: string;
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
    accountType?: string;
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
