/**
 * Strategy Assignment Matrix — Track 5 (Pass 2)
 *
 * Operator tool to assign DEPLOYED strategies to broker accounts.
 * Rows = accounts (operator + family members from broker_accounts).
 * Columns = DEPLOYED strategies.
 * Cells = assignment status (click to assign/unassign).
 *
 * MFFU collaborative-trading warning: red border + tooltip when
 * assignment would put 2+ family members on the same MFFU strategy.
 *
 * Wired to:
 *   GET  /api/strategy-assignments        — current assignments
 *   GET  /api/broker-accounts             — available accounts (Track 4)
 *   GET  /api/strategies?state=DEPLOYED   — deployable strategies
 *   POST /api/strategy-assignments        — assign
 *   DELETE /api/strategy-assignments/:id  — unassign
 *   POST /api/strategy-assignments/:id/release — publish-to-family toggle
 */

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Users, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Share2 } from "lucide-react";
import { api } from "@/lib/api-client";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assignment {
  id: number;
  accountId: string;
  strategyId: string;
  status: "active" | "paused" | "archived";
  releasedToFamily: boolean;
  familyMemberLabel: string | null;
  assignedAt: string;
  assignedBy: string;
}

interface BrokerAccount {
  accountId: string;
  firmId: string;
  brokerType: string;
  accountIdExternal: string | null;
  enabled: boolean;
  // Track 5 display: label injected by the service or set at account creation
  label?: string;
}

interface Strategy {
  id: string;
  name: string;
  symbol: string;
  lifecycleState: string;
}

// ─── Collaborative-trading warning detection ──────────────────────────────────

function detectCollaborativeTradingWarning(
  assignments: Assignment[],
  accounts: BrokerAccount[],
  strategyId: string,
  targetAccountId: string,
): boolean {
  // Topstep: allowed
  const targetAccount = accounts.find((a) => a.accountId === targetAccountId);
  if (!targetAccount || targetAccount.firmId === "topstep") return false;
  if (targetAccount.firmId !== "mffu") return false;

  // Count family member assignments on MFFU for this strategy
  const mffuFamilyAssignments = assignments.filter((a) => {
    if (a.strategyId !== strategyId || a.status !== "active") return false;
    const acc = accounts.find((ac) => ac.accountId === a.accountId);
    return acc?.firmId === "mffu" && a.familyMemberLabel !== null;
  });

  // Including this new assignment, would there be 2+?
  const thisIsFamilyMember = true; // If the operator is assigning to a family account
  const countAfterAssign = mffuFamilyAssignments.length + (thisIsFamilyMember ? 1 : 0);
  return countAfterAssign >= 2;
}

// ─── Cell component ───────────────────────────────────────────────────────────

function AssignmentCell({
  accountId,
  strategyId,
  accounts,
  assignments,
  onAssign,
  onUnassign,
  onToggleRelease,
  loading,
}: {
  accountId: string;
  strategyId: string;
  accounts: BrokerAccount[];
  assignments: Assignment[];
  onAssign: (accountId: string, strategyId: string) => void;
  onUnassign: (assignmentId: number) => void;
  onToggleRelease: (assignmentId: number, current: boolean) => void;
  loading: boolean;
}) {
  const assignment = assignments.find(
    (a) => a.accountId === accountId && a.strategyId === strategyId && a.status === "active",
  );

  const hasWarning = !assignment && detectCollaborativeTradingWarning(
    assignments,
    accounts,
    strategyId,
    accountId,
  );

  const account = accounts.find((a) => a.accountId === accountId);
  const isMFFU = account?.firmId === "mffu";

  if (assignment) {
    return (
      <div className="flex flex-col items-center gap-1">
        <motion.button
          whileHover={{ scale: 1.05 }}
          onClick={() => onUnassign(assignment.id)}
          disabled={loading}
          className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center hover:bg-red-500/20 hover:border-red-400/40 transition-colors group"
          title="Click to unassign"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 group-hover:text-red-400" />
        </motion.button>
        {/* Publish-to-family toggle */}
        <button
          onClick={() => onToggleRelease(assignment.id, assignment.releasedToFamily)}
          disabled={loading}
          title={assignment.releasedToFamily ? "Retract from family" : "Publish to family"}
          className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
            assignment.releasedToFamily
              ? "bg-blue-500/20 border border-blue-400/40 text-blue-400"
              : "bg-white/5 border border-white/10 text-white/30 hover:text-blue-400"
          }`}
        >
          <Share2 className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative group">
      <motion.button
        whileHover={{ scale: 1.05 }}
        onClick={() => onAssign(accountId, strategyId)}
        disabled={loading}
        className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${
          hasWarning
            ? "border-red-400/60 bg-red-500/10 hover:bg-red-500/20"
            : "border-white/10 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-500/30"
        }`}
        title={hasWarning ? "Warning: MFFU collaborative-trading rule violation — assigning will fire compliance alert" : "Click to assign"}
      >
        {hasWarning ? (
          <AlertTriangle className="w-4 h-4 text-red-400" />
        ) : (
          <span className="text-white/20 text-xs">+</span>
        )}
      </motion.button>
      {hasWarning && isMFFU && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-red-900/90 text-red-200 text-xs rounded px-2 py-1 whitespace-nowrap pointer-events-none border border-red-400/30">
          MFFU collaborative-trading violation
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StrategyAssignmentMatrix() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [assignResp, accountsResp, strategiesResp] = await Promise.all([
        api.get<{ success: boolean; data: Assignment[] }>("/strategy-assignments"),
        // Track 4 provides /broker-accounts — graceful fallback if not available yet
        api.get<{ success: boolean; data: BrokerAccount[] }>("/broker-accounts").catch(() => ({
          success: true,
          data: [] as BrokerAccount[],
        })),
        api.get<{ strategies: Strategy[] }>("/strategies?state=DEPLOYED"),
      ]);

      if (assignResp.success) setAssignments(assignResp.data);
      if (accountsResp.success) setAccounts(accountsResp.data);
      if (strategiesResp.strategies) {
        setStrategies(strategiesResp.strategies.filter((s) => s.lifecycleState === "DEPLOYED"));
      }
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch assignment data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleAssign = async (accountId: string, strategyId: string) => {
    setActionLoading(true);
    try {
      const account = accounts.find((a) => a.accountId === accountId);
      const resp = await api.post<{ success: boolean; data: Assignment; existingAssignment?: Assignment }>(
        "/strategy-assignments",
        {
          accountId,
          strategyId,
          assignedBy: "operator",
          familyMemberLabel: account?.label ?? null,
        },
      );
      if (resp.success && resp.data) {
        setAssignments((prev) => [...prev.filter((a) => a.id !== resp.data.id), resp.data]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign strategy");
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnassign = async (assignmentId: number) => {
    setActionLoading(true);
    try {
      await api.del(`/strategy-assignments/${assignmentId}`);
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unassign strategy");
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleRelease = async (assignmentId: number, currentReleased: boolean) => {
    setActionLoading(true);
    try {
      const resp = await api.post<{ success: boolean; data: Assignment }>(
        `/strategy-assignments/${assignmentId}/release`,
        { released: !currentReleased },
      );
      if (resp.success && resp.data) {
        setAssignments((prev) =>
          prev.map((a) => (a.id === assignmentId ? resp.data : a)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update release status");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
        <span className="ml-2 text-white/50 text-sm">Loading assignment matrix...</span>
      </div>
    );
  }

  if (accounts.length === 0 && !loading) {
    return (
      <div className="backdrop-blur-sm bg-white/5 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center gap-3 mb-2">
          <Users className="w-5 h-5 text-emerald-400" />
          <h3 className="text-white font-semibold">Strategy Assignment Matrix</h3>
        </div>
        <p className="text-white/40 text-sm">
          No broker accounts configured yet. Add accounts via Track 4 broker abstraction layer.
          Migration 0098 required.
        </p>
      </div>
    );
  }

  return (
    <div className="backdrop-blur-sm bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-emerald-400" />
          <div>
            <h3 className="text-white font-semibold">Strategy Assignment Matrix</h3>
            <p className="text-white/40 text-xs mt-0.5">
              {accounts.length} account{accounts.length !== 1 ? "s" : ""} ·{" "}
              {strategies.length} deployed strateg{strategies.length !== 1 ? "ies" : "y"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actionLoading && <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />}
          <button
            onClick={() => void fetchData()}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-white/40" />
          </button>
        </div>
      </div>

      {error && (
        <div className="px-6 py-3 bg-red-500/10 border-b border-red-400/20">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {strategies.length === 0 ? (
        <div className="px-6 py-8 text-center text-white/30 text-sm">
          No DEPLOYED strategies available. Strategies must reach DEPLOYED state before assignment.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left px-6 py-3 text-white/50 font-medium sticky left-0 bg-[#0a0a0f] z-10">
                  Account
                </th>
                {strategies.map((s) => (
                  <th
                    key={s.id}
                    className="px-4 py-3 text-white/50 font-medium text-center min-w-[100px]"
                  >
                    <div className="text-xs font-mono text-emerald-400/80">{s.symbol}</div>
                    <div
                      className="truncate max-w-[90px] text-white/60 text-xs"
                      title={s.name}
                    >
                      {s.name.length > 12 ? s.name.slice(0, 12) + "…" : s.name}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts
                .filter((a) => a.enabled)
                .map((account) => {
                  const label =
                    account.label ??
                    assignments.find((a) => a.accountId === account.accountId)?.familyMemberLabel ??
                    account.accountIdExternal ??
                    account.accountId.slice(0, 8);

                  return (
                    <tr
                      key={account.accountId}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-6 py-3 sticky left-0 bg-[#0a0a0f] z-10">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${
                              account.firmId === "mffu"
                                ? "bg-violet-500/10 text-violet-400 border border-violet-400/20"
                                : "bg-blue-500/10 text-blue-400 border border-blue-400/20"
                            }`}
                          >
                            {account.firmId}
                          </span>
                          <span className="text-white/80 text-xs">{label}</span>
                        </div>
                      </td>
                      {strategies.map((strategy) => (
                        <td key={strategy.id} className="px-4 py-3 text-center">
                          <div className="flex justify-center">
                            <AssignmentCell
                              accountId={account.accountId}
                              strategyId={strategy.id}
                              accounts={accounts}
                              assignments={assignments}
                              onAssign={handleAssign}
                              onUnassign={handleUnassign}
                              onToggleRelease={handleToggleRelease}
                              loading={actionLoading}
                            />
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div className="px-6 py-3 border-t border-white/10 flex items-center gap-6 text-xs text-white/30">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Assigned</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Share2 className="w-3.5 h-3.5 text-blue-400" />
          <span>Released to family</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
          <span>MFFU collaborative-trading warning</span>
        </div>
        {lastRefresh && (
          <span className="ml-auto">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
