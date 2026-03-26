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
}

interface SimulateResponse {
  backtestId: string;
  strategyId: string;
  metrics: { avgDailyPnl: number; maxDrawdown: number; winRate: number; profitFactor: number };
  results: SimulateResult[];
  bestFirm: SimulateResult | null;
}

export type { Firm, FirmRanking, RankingResponse, PayoutMonth, PayoutResponse, TimelineResponse, SimulateResult, SimulateResponse, FirmAccountDetail };

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
