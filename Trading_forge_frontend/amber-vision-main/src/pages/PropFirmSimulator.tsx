import { motion } from "framer-motion";
import { useState } from "react";
import {
  Building2, DollarSign, TrendingUp, TrendingDown, Target,
  Percent, Trophy, Play, ChevronDown, ChevronUp, ShieldCheck, Calendar,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, LineChart, Line,
} from "recharts";
import { StatusBadge } from "@/components/forge/StatusBadge";
import {
  useRankFirms,
  usePayoutProjection,
  survivalVerdict,
  formatSurvivalPct,
} from "@/hooks/usePropFirm";
import type { FirmRanking, PayoutResponse } from "@/hooks/usePropFirm";
import { toast } from "sonner";

export default function PropFirmSimulator() {
  // Form state
  const [avgDailyPnl, setAvgDailyPnl] = useState(500);
  const [maxDrawdown, setMaxDrawdown] = useState(1500);
  const [winRate, setWinRate] = useState(65);
  const [profitFactor, setProfitFactor] = useState(2.5);

  // Selection state
  const [expandedFirm, setExpandedFirm] = useState<string | null>(null);
  const [payoutData, setPayoutData] = useState<PayoutResponse | null>(null);

  // Mutations
  const rankMutation = useRankFirms();
  const payoutMutation = usePayoutProjection();

  const handleRank = () => {
    rankMutation.mutate(
      { avgDailyPnl, maxDrawdown, winRate: winRate / 100, profitFactor },
      {
        onSuccess: () => {
          toast.success("Firms ranked successfully");
          setExpandedFirm(null);
          setPayoutData(null);
        },
        onError: (err) => {
          toast.error(err?.message ?? "Failed to rank firms");
        },
      }
    );
  };

  const handleExpandFirm = (ranking: FirmRanking) => {
    const key = `${ranking.firm}-${ranking.accountType}`;
    if (expandedFirm === key) {
      setExpandedFirm(null);
      setPayoutData(null);
      return;
    }
    setExpandedFirm(key);
    payoutMutation.mutate(
      { firm: ranking.firm, accountType: ranking.accountType, avgDailyPnl },
      {
        onSuccess: (data) => setPayoutData(data),
        onError: () => setPayoutData(null),
      }
    );
  };

  // Backend already orders rankings (passes first, then ROI desc). For B14
  // survival-first redesign we re-sort client-side: highest survival first
  // among passing firms, ROI as tiebreaker. Falls back to ROI sort when no
  // survival data is present (e.g. server fallback / pre-B14 cache) so the
  // page never looks broken if survival is unavailable.
  //
  // Comparator rules (in order):
  //   1) Passing firms above failing firms (preserved from backend behavior).
  //   2) Survival probability descending (null/undefined sorts LAST).
  //   3) ROI descending (tiebreaker).
  const rawRankings = rankMutation.data?.rankings ?? [];
  const hasAnySurvival = rawRankings.some(
    (r) => r.survivalProbability != null,
  );
  const rankings = [...rawRankings].sort((a, b) => {
    if (a.passes !== b.passes) return a.passes ? -1 : 1;
    if (hasAnySurvival) {
      const aP = a.survivalProbability;
      const bP = b.survivalProbability;
      if (aP == null && bP == null) {
        // both null — fall through to ROI tiebreaker
      } else if (aP == null) {
        return 1;
      } else if (bP == null) {
        return -1;
      } else if (aP !== bP) {
        return bP - aP;
      }
    }
    return b.roi - a.roi;
  });
  const bestFirm = rankMutation.data?.bestFirm;

  // Trust Score headline = highest survival across passing firms (or all
  // firms when none pass — operator still sees the least-bad option).
  const passingRankings = rankings.filter((r) => r.passes);
  const trustPool = passingRankings.length > 0 ? passingRankings : rankings;
  const bestSurvivalRanking =
    hasAnySurvival && trustPool.length > 0
      ? trustPool.reduce<FirmRanking | null>((best, cur) => {
          if (cur.survivalProbability == null) return best;
          if (best == null || best.survivalProbability == null) return cur;
          return cur.survivalProbability > (best.survivalProbability ?? -1)
            ? cur
            : best;
        }, null)
      : null;
  const bestSurvivalProb = bestSurvivalRanking?.survivalProbability ?? null;

  // Avg Days to Pass — averaged across passing firms only (matches the
  // operational meaning: "how fast does a deployable firm get me funded").
  const avgDaysToPass =
    passingRankings.length > 0
      ? Math.round(
          passingRankings.reduce((sum, r) => sum + r.evalDays, 0) /
            passingRankings.length,
        )
      : null;

  // Best Monthly Net — kept visible but DEMOTED from headline. Drawn from
  // the best-survival firm when survival is available, else from the
  // top-of-list firm (which is now survival-sorted, but ROI-sorted when
  // survival data is missing).
  const bestNetSourceRanking =
    bestSurvivalRanking ??
    (passingRankings.length > 0 ? passingRankings[0] : null);
  const bestMonthlyNet = bestNetSourceRanking?.monthlyNet ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          Prop Firm Simulator
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          Rank prop firms by survival probability first; ROI and payout projections kept secondary
        </p>
      </div>

      {/* Input Form */}
      <div className="forge-card p-6">
        <h2 className="text-sm font-medium text-text-secondary mb-4 flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Strategy Metrics
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="text-[10px] uppercase tracking-widest text-text-muted block mb-1.5">
              Avg Daily P&L ($)
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="number"
                value={avgDailyPnl}
                onChange={(e) => setAvgDailyPnl(Number(e.target.value))}
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-mono bg-[hsl(var(--surface-2))] text-foreground border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-text-muted block mb-1.5">
              Max Drawdown ($)
            </label>
            <div className="relative">
              <TrendingDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="number"
                value={maxDrawdown}
                onChange={(e) => setMaxDrawdown(Number(e.target.value))}
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-mono bg-[hsl(var(--surface-2))] text-foreground border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-text-muted block mb-1.5">
              Win Rate (%)
            </label>
            <div className="relative">
              <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="number"
                value={winRate}
                onChange={(e) => setWinRate(Number(e.target.value))}
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-mono bg-[hsl(var(--surface-2))] text-foreground border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
                min={0}
                max={100}
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-widest text-text-muted block mb-1.5">
              Profit Factor
            </label>
            <div className="relative">
              <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="number"
                value={profitFactor}
                onChange={(e) => setProfitFactor(Number(e.target.value))}
                step={0.1}
                min={0}
                className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-mono bg-[hsl(var(--surface-2))] text-foreground border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleRank}
            disabled={rankMutation.isPending}
            className="px-4 py-2 rounded-full text-xs font-medium bg-primary text-primary-foreground flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:brightness-110"
          >
            <Play className="w-3 h-3" />
            {rankMutation.isPending ? "Ranking..." : "Rank Firms"}
          </button>
        </div>
      </div>

      {/* Error state */}
      {rankMutation.isError && (
        <div className="forge-card p-6 border-loss/30">
          <p className="text-sm text-loss">
            Failed to rank firms: {rankMutation.error?.message}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!rankMutation.data && !rankMutation.isPending && !rankMutation.isError && (
        <div className="forge-card p-12 text-center">
          <Building2 className="w-8 h-8 text-text-muted mx-auto mb-3" />
          <p className="text-sm text-text-muted">
            Enter your strategy metrics above and click Rank Firms to compare prop firm options
          </p>
        </div>
      )}

      {/* Loading state */}
      {rankMutation.isPending && (
        <div className="flex items-center justify-center h-32">
          <div className="text-text-muted text-sm">Ranking prop firms...</div>
        </div>
      )}

      {/* Results */}
      {rankMutation.data && !rankMutation.isPending && (
        <>
          {/* Summary KPIs — B14 survival-first hierarchy.
              Position 1: Trust Score (verdict-colored survival probability).
              Position 2: Best Survival Firm (firm name with highest survival).
              Position 3: Best Monthly Net (DEMOTED — still visible).
              Position 4: Avg Days to Pass (passing firms only). */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* KPI 1 — Trust Score (HEADLINE) */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0 }}
              className="forge-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-text-muted">
                  Trust Score
                </span>
              </div>
              {bestSurvivalProb != null ? (
                <div className="flex items-baseline gap-2">
                  <StatusBadge variant={survivalVerdict(bestSurvivalProb)}>
                    {formatSurvivalPct(bestSurvivalProb)}
                  </StatusBadge>
                  <span className="text-[10px] uppercase tracking-widest text-text-muted">
                    6-mo survival
                  </span>
                </div>
              ) : (
                <p className="text-xl font-mono font-semibold text-text-muted">
                  —
                </p>
              )}
              <p className="mt-1 text-[10px] text-text-muted">
                advisory · Phase 0
              </p>
            </motion.div>

            {/* KPI 2 — Best Survival Firm */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="forge-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-text-muted">
                  Best Survival Firm
                </span>
              </div>
              <p className="text-xl font-mono font-semibold text-foreground truncate">
                {bestSurvivalRanking?.displayName ?? bestFirm ?? "—"}
              </p>
            </motion.div>

            {/* KPI 3 — Best Monthly Net (DEMOTED from headline) */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="forge-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-text-muted">
                  Best Monthly Net
                </span>
              </div>
              <p className="text-xl font-mono font-semibold text-foreground">
                {bestMonthlyNet != null
                  ? `$${bestMonthlyNet.toLocaleString()}`
                  : "—"}
              </p>
            </motion.div>

            {/* KPI 4 — Avg Days to Pass (replaces Firms Passing) */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="forge-card p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-3.5 h-3.5 text-primary" />
                <span className="text-[10px] uppercase tracking-widest text-text-muted">
                  Avg Days to Pass
                </span>
              </div>
              <p className="text-xl font-mono font-semibold text-foreground">
                {avgDaysToPass != null ? `${avgDaysToPass} days` : "—"}
              </p>
              <p className="mt-1 text-[10px] text-text-muted">
                {passingRankings.length} of {rankings.length} firms pass
              </p>
            </motion.div>
          </div>

          {/* Rankings Table — B14 column order: Firm | Trust Score | Status |
              ROI | Eval Days | Monthly Net. Trust Score is the new headline
              column; ROI is preserved but sits between Status and Eval Days. */}
          <div className="forge-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border/10">
              <h2 className="text-sm font-medium text-text-secondary flex items-center gap-2">
                <Trophy className="w-4 h-4 text-primary" />
                Firm Rankings
                <span className="text-[10px] text-text-muted normal-case tracking-normal font-normal">
                  ·{" "}
                  {hasAnySurvival
                    ? "sorted by Trust Score (advisory · Phase 0)"
                    : "sorted by ROI"}
                </span>
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/10">
                    {["Firm", "Trust Score", "Status", "ROI", "Eval Days", "Monthly Net"].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-[10px] uppercase tracking-widest text-text-muted font-medium"
                        >
                          {h === "Trust Score" ? (
                            <span className="inline-flex items-center gap-1.5">
                              {h}
                              <span className="normal-case tracking-normal text-[9px] text-text-muted font-normal">
                                advisory
                              </span>
                            </span>
                          ) : (
                            h
                          )}
                        </th>
                      )
                    )}
                    <th className="px-4 py-3 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {rankings.map((r, idx) => {
                    const key = `${r.firm}-${r.accountType}`;
                    const isExpanded = expandedFirm === key;
                    // "Best" row highlight: prefer the highest-survival passing
                    // firm when survival is available; fall back to the
                    // server-supplied bestFirm (ROI-based) when not.
                    const isBest =
                      hasAnySurvival && bestSurvivalRanking
                        ? r.firm === bestSurvivalRanking.firm && r.passes
                        : r.firm === bestFirm && r.passes;
                    const survivalP = r.survivalProbability;
                    return (
                      <motion.tr
                        key={key}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.03 }}
                        className="group relative"
                      >
                        <td colSpan={7} className="p-0">
                          <button
                            onClick={() => handleExpandFirm(r)}
                            className={`w-full text-left grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr_auto] items-center hover:bg-surface-2/50 transition-colors ${
                              isExpanded ? "bg-surface-2/30" : ""
                            } ${isBest ? "border-l-2 border-l-primary" : ""}`}
                          >
                            {/* Firm */}
                            <span className="px-4 py-3 text-sm font-medium text-foreground">
                              <span className="block">{r.displayName}</span>
                              <span className="block text-[10px] text-text-muted font-mono mt-0.5">
                                {r.accountType}
                              </span>
                            </span>
                            {/* Trust Score (NEW headline column) */}
                            <span className="px-4 py-3">
                              {survivalP != null ? (
                                <StatusBadge variant={survivalVerdict(survivalP)}>
                                  {formatSurvivalPct(survivalP)}
                                </StatusBadge>
                              ) : (
                                <span className="text-xs font-mono text-text-muted">
                                  —
                                </span>
                              )}
                            </span>
                            {/* Status */}
                            <span className="px-4 py-3">
                              <StatusBadge
                                variant={r.passes ? "profit" : "loss"}
                                dot
                              >
                                {r.passes ? "Pass" : "Fail"}
                              </StatusBadge>
                            </span>
                            {/* ROI */}
                            <span
                              className={`px-4 py-3 text-xs font-mono font-semibold ${r.roi > 0 ? "text-profit" : "text-loss"}`}
                            >
                              {r.roi.toFixed(0)}%
                            </span>
                            {/* Eval Days */}
                            <span className="px-4 py-3 text-xs font-mono text-text-secondary">
                              {r.evalDays}
                            </span>
                            {/* Monthly Net */}
                            <span
                              className={`px-4 py-3 text-xs font-mono ${r.passes ? "text-profit" : "text-text-muted"}`}
                            >
                              ${r.monthlyNet.toLocaleString()}
                            </span>
                            <span className="px-4 py-3 text-text-muted">
                              {isExpanded ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                            </span>
                          </button>

                          {/* Expanded Detail: Payout Projection */}
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              transition={{ duration: 0.3 }}
                              className="border-t border-border/10 bg-surface-1/50"
                            >
                              {/* Violations */}
                              {r.violations.length > 0 && (
                                <div className="px-6 pt-4">
                                  <p className="text-[10px] uppercase tracking-widest text-text-muted mb-2">Violations</p>
                                  <div className="flex flex-wrap gap-2">
                                    {r.violations.map((v) => (
                                      <StatusBadge key={v} variant="loss">{v}</StatusBadge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Firm Details */}
                              <div className="px-6 py-4 grid grid-cols-2 lg:grid-cols-5 gap-4">
                                {[
                                  { label: "Payout Split", value: `${(r.payoutSplit * 100).toFixed(0)}%` },
                                  { label: "Max Drawdown", value: `$${r.maxDrawdown.toLocaleString()}` },
                                  { label: "Max Contracts", value: r.maxContracts.toString() },
                                  { label: "Trailing DD", value: r.trailing },
                                  { label: "Annualized ROI", value: `${r.annualizedRoi.toFixed(0)}%` },
                                ].map((d) => (
                                  <div key={d.label}>
                                    <span className="text-[10px] uppercase tracking-widest text-text-muted block mb-1">
                                      {d.label}
                                    </span>
                                    <span className="text-sm font-mono text-foreground">{d.value}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Survival Curve (PRIMARY chart — B14 Phase 0 advisory).
                                  Plotted across 30/90/180/365 day horizons.
                                  Falls back to a "no data" note when survival
                                  is unavailable (e.g. compute timeout). */}
                              <div className="px-6 pb-4">
                                <div className="flex items-center justify-between mb-3">
                                  <p className="text-[10px] uppercase tracking-widest text-text-muted inline-flex items-center gap-2">
                                    Survival Curve
                                    <span className="normal-case tracking-normal text-[9px] text-text-muted font-normal">
                                      advisory · Phase 0
                                    </span>
                                  </p>
                                  {r.survivalProbability != null && (
                                    <span className="text-xs">
                                      <StatusBadge variant={survivalVerdict(r.survivalProbability)}>
                                        {formatSurvivalPct(r.survivalProbability)} 6-mo
                                      </StatusBadge>
                                    </span>
                                  )}
                                </div>
                                {r.survivalCurve ? (
                                  <div className="h-[180px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                      <LineChart
                                        data={[
                                          { horizon: 30, p: r.survivalCurve.p_30d },
                                          { horizon: 90, p: r.survivalCurve.p_90d },
                                          { horizon: 180, p: r.survivalCurve.p_180d },
                                          { horizon: 365, p: r.survivalCurve.p_365d },
                                        ]}
                                      >
                                        <CartesianGrid
                                          strokeDasharray="3 3"
                                          stroke="hsla(240,5%,18%,0.5)"
                                        />
                                        <XAxis
                                          dataKey="horizon"
                                          type="number"
                                          domain={[0, 365]}
                                          ticks={[30, 90, 180, 365]}
                                          tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }}
                                          tickLine={false}
                                          axisLine={false}
                                          label={{
                                            value: "Horizon (days)",
                                            position: "insideBottom",
                                            offset: -5,
                                            fill: "hsl(240,4%,46%)",
                                            fontSize: 10,
                                          }}
                                        />
                                        <YAxis
                                          domain={[0, 1]}
                                          ticks={[0, 0.25, 0.5, 0.75, 1]}
                                          tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }}
                                          tickLine={false}
                                          axisLine={false}
                                          tickFormatter={(v) => `${Math.round(v * 100)}%`}
                                        />
                                        <Tooltip
                                          contentStyle={{
                                            background: "hsl(240,10%,6%)",
                                            border: "1px solid hsl(240,5%,18%)",
                                            borderRadius: 8,
                                            fontSize: 12,
                                          }}
                                          labelStyle={{ color: "hsl(240,4%,63%)" }}
                                          formatter={(v: number) => [
                                            `${(v * 100).toFixed(1)}%`,
                                            "Survival",
                                          ]}
                                          labelFormatter={(label: number) => `Day ${label}`}
                                        />
                                        <ReferenceLine
                                          y={0.5}
                                          stroke="hsl(0,72%,51%)"
                                          strokeDasharray="4 4"
                                          strokeOpacity={0.4}
                                        />
                                        <Line
                                          type="monotone"
                                          dataKey="p"
                                          name="Survival"
                                          stroke="hsl(142,71%,45%)"
                                          strokeWidth={2}
                                          dot={{ r: 4, fill: "hsl(142,71%,45%)" }}
                                          activeDot={{ r: 6 }}
                                          isAnimationActive={false}
                                        />
                                      </LineChart>
                                    </ResponsiveContainer>
                                  </div>
                                ) : (
                                  <div className="h-[120px] flex items-center justify-center text-xs text-text-muted border border-dashed border-border/30 rounded-lg">
                                    Survival data unavailable for this firm.
                                  </div>
                                )}
                                {r.evidenceWeight != null && r.evidenceWeight > 0 && (
                                  <p className="mt-2 text-[10px] text-text-muted">
                                    Evidence weight: {r.evidenceWeight} adversarial events factored into priors
                                  </p>
                                )}
                              </div>

                              {/* Payout Projection Chart (SECONDARY — demoted
                                  from primary position by B14). */}
                              {payoutMutation.isPending && (
                                <div className="px-6 pb-4 text-xs text-text-muted">
                                  Loading payout projection...
                                </div>
                              )}
                              {payoutData && expandedFirm === key && (
                                <div className="px-6 pb-6">
                                  <div className="flex items-center justify-between mb-3">
                                    <p className="text-[10px] uppercase tracking-widest text-text-muted">
                                      Monthly Payout Projection
                                      <span className="ml-2 normal-case tracking-normal text-[9px] text-text-muted font-normal">
                                        ROI · secondary
                                      </span>
                                    </p>
                                    <div className="flex gap-4 text-xs">
                                      <span className="text-text-muted">
                                        Break-even:{" "}
                                        <span className="text-foreground font-mono">
                                          {payoutData.breakEvenMonth != null
                                            ? `Month ${payoutData.breakEvenMonth}`
                                            : "N/A"}
                                        </span>
                                      </span>
                                      <span className="text-text-muted">
                                        Total Profit:{" "}
                                        <span className="text-profit font-mono">
                                          ${payoutData.totalProfit.toLocaleString()}
                                        </span>
                                      </span>
                                    </div>
                                  </div>
                                  <div className="h-[220px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                      <BarChart data={payoutData.monthlyProjection}>
                                        <CartesianGrid
                                          strokeDasharray="3 3"
                                          stroke="hsla(240,5%,18%,0.5)"
                                        />
                                        <XAxis
                                          dataKey="month"
                                          tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }}
                                          tickLine={false}
                                          axisLine={false}
                                          label={{
                                            value: "Month",
                                            position: "insideBottom",
                                            offset: -5,
                                            fill: "hsl(240,4%,46%)",
                                            fontSize: 10,
                                          }}
                                        />
                                        <YAxis
                                          tick={{ fill: "hsl(240,4%,46%)", fontSize: 10 }}
                                          tickLine={false}
                                          axisLine={false}
                                          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                                        />
                                        <Tooltip
                                          contentStyle={{
                                            background: "hsl(240,10%,6%)",
                                            border: "1px solid hsl(240,5%,18%)",
                                            borderRadius: 8,
                                            fontSize: 12,
                                          }}
                                          labelStyle={{ color: "hsl(240,4%,63%)" }}
                                          formatter={(v: number, name: string) => [
                                            `$${v.toLocaleString()}`,
                                            name,
                                          ]}
                                        />
                                        {payoutData.breakEvenMonth != null && (
                                          <ReferenceLine
                                            x={payoutData.breakEvenMonth}
                                            stroke="hsl(45,100%,50%)"
                                            strokeDasharray="6 4"
                                            strokeOpacity={0.6}
                                            label={{
                                              value: "Break-even",
                                              fill: "hsl(45,100%,50%)",
                                              fontSize: 10,
                                              position: "insideTopRight",
                                            }}
                                          />
                                        )}
                                        <Bar
                                          dataKey="cumulativeProfit"
                                          name="Cumulative Profit"
                                          radius={[2, 2, 0, 0]}
                                          fill="hsl(45,100%,50%)"
                                          fillOpacity={0.7}
                                        />
                                        <Bar
                                          dataKey="netPayout"
                                          name="Net Payout"
                                          radius={[2, 2, 0, 0]}
                                          fill="hsl(142,71%,45%)"
                                          fillOpacity={0.5}
                                        />
                                      </BarChart>
                                    </ResponsiveContainer>
                                  </div>

                                  {/* Monthly breakdown mini-table */}
                                  <div className="mt-4 max-h-[200px] overflow-y-auto">
                                    <table className="w-full">
                                      <thead>
                                        <tr className="border-b border-border/10">
                                          {["Month", "Phase", "Gross P&L", "Costs", "Net Payout", "Cumulative"].map(
                                            (h) => (
                                              <th
                                                key={h}
                                                className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-text-muted font-medium"
                                              >
                                                {h}
                                              </th>
                                            )
                                          )}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {payoutData.monthlyProjection.map((m) => (
                                          <tr
                                            key={m.month}
                                            className="border-b border-border/5 hover:bg-surface-2/30 transition-colors"
                                          >
                                            <td className="px-3 py-2 text-xs font-mono text-foreground">
                                              {m.month}
                                            </td>
                                            <td className="px-3 py-2">
                                              <StatusBadge
                                                variant={m.phase === "funded" ? "profit" : "amber"}
                                              >
                                                {m.phase}
                                              </StatusBadge>
                                            </td>
                                            <td className="px-3 py-2 text-xs font-mono text-foreground">
                                              ${m.grossPnl.toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2 text-xs font-mono text-loss">
                                              -${m.costs.toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2 text-xs font-mono text-profit">
                                              ${m.netPayout.toLocaleString()}
                                            </td>
                                            <td className={`px-3 py-2 text-xs font-mono font-semibold ${m.cumulativeProfit >= 0 ? "text-profit" : "text-loss"}`}>
                                              ${m.cumulativeProfit.toLocaleString()}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}
                            </motion.div>
                          )}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
