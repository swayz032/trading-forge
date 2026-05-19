/**
 * Family Published Strategies Panel — Track 5 (Pass 2)
 *
 * Operator-side overview: lists strategies currently released to family members
 * (released_to_family = true). Shows which family member runs each strategy,
 * and provides a quick retract button.
 *
 * This is the operator's visibility panel into the family assignment state.
 * Track 6 uses this data to generate per-recipient Pine files.
 *
 * Wired to:
 *   GET /api/strategy-assignments/family — strategies with released_to_family=true
 *   POST /api/strategy-assignments/:id/release — retract
 */

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Share2, Users, X, Loader2, RefreshCw, FileText, ChevronDown } from "lucide-react";
import { api } from "@/lib/api-client";

// ─── Family onboarding docs (Pass 4 Track 9) ─────────────────────────────────
// Static links to operator-curated runbooks. These are markdown files in the
// repo's docs/ folder; the operator hands them to family members via Discord
// or email. Linked from each family-published row so the operator can grab
// the right doc without leaving the dashboard.
const FAMILY_DOCS: Array<{ label: string; path: string }> = [
  { label: "Onboarding runbook", path: "docs/family-onboarding-runbook.md" },
  { label: "Setup checklist", path: "docs/family-onboarding-checklist.md" },
  { label: "Monitoring guide", path: "docs/family-monitoring-guide.md" },
  { label: "Strategy update runbook", path: "docs/strategy-update-runbook.md" },
  { label: "2026 rules cheatsheet", path: "docs/family-2026-rules-cheatsheet.md" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface FamilyAssignment {
  id: number;
  accountId: string;
  strategyId: string;
  status: "active" | "paused" | "archived";
  releasedToFamily: boolean;
  familyMemberLabel: string | null;
  assignedAt: string;
  assignedBy: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FamilyPublishedStrategiesPanel() {
  const [assignments, setAssignments] = useState<FamilyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [retracting, setRetracting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [docsOpenFor, setDocsOpenFor] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const resp = await api.get<{ success: boolean; data: FamilyAssignment[] }>(
        "/strategy-assignments/family",
      );
      if (resp.success) {
        setAssignments(resp.data);
      }
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch family assignments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRetract = async (assignmentId: number) => {
    setRetracting(assignmentId);
    try {
      const resp = await api.post<{ success: boolean; data: FamilyAssignment }>(
        `/strategy-assignments/${assignmentId}/release`,
        { released: false },
      );
      if (resp.success) {
        setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to retract strategy");
    } finally {
      setRetracting(null);
    }
  };

  if (loading) {
    return (
      <div className="backdrop-blur-sm bg-white/5 border border-white/10 rounded-2xl p-6 flex items-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
        <span className="text-white/50 text-sm">Loading family assignments...</span>
      </div>
    );
  }

  return (
    <div className="backdrop-blur-sm bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Share2 className="w-5 h-5 text-blue-400" />
          <div>
            <h3 className="text-white font-semibold">Family Published Strategies</h3>
            <p className="text-white/40 text-xs mt-0.5">
              Strategies currently released for family member use
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      {assignments.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <Users className="w-10 h-10 text-white/10 mx-auto mb-3" />
          <p className="text-white/30 text-sm">No strategies published to family members yet.</p>
          <p className="text-white/20 text-xs mt-1">
            Use the Assignment Matrix to assign and release strategies to family.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-white/5">
          {assignments.map((assignment) => (
            <motion.div
              key={assignment.id}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-6 py-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                {/* Family member label */}
                <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-400/20 flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <div className="text-white/90 text-sm font-medium">
                    {assignment.familyMemberLabel ?? "Family Member"}
                  </div>
                  <div className="text-white/40 text-xs font-mono mt-0.5">
                    strategy: {assignment.strategyId.slice(0, 8)}…
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-xs text-white/30">
                    Assigned {new Date(assignment.assignedAt).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-white/20">by {assignment.assignedBy}</div>
                </div>

                {/* Docs dropdown — Pass 4 Track 9 */}
                <div className="relative">
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() =>
                      setDocsOpenFor(docsOpenFor === assignment.id ? null : assignment.id)
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-400/20 text-emerald-300 text-xs hover:bg-emerald-500/20 transition-colors"
                    title="Send onboarding docs to family member"
                  >
                    <FileText className="w-3 h-3" />
                    Docs
                    <ChevronDown className="w-3 h-3" />
                  </motion.button>
                  {docsOpenFor === assignment.id && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="absolute right-0 mt-1 w-64 rounded-lg bg-[#0b0f0d] border border-white/10 shadow-2xl z-10 overflow-hidden"
                    >
                      {FAMILY_DOCS.map((doc) => (
                        <a
                          key={doc.path}
                          href={`/${doc.path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setDocsOpenFor(null)}
                          className="block px-4 py-2 text-xs text-white/80 hover:bg-emerald-500/10 hover:text-emerald-300 transition-colors"
                        >
                          {doc.label}
                        </a>
                      ))}
                    </motion.div>
                  )}
                </div>

                {/* Retract button */}
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void handleRetract(assignment.id)}
                  disabled={retracting === assignment.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-400/20 text-red-400 text-xs hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  title="Retract — stop publishing to family member"
                >
                  {retracting === assignment.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  Retract
                </motion.button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Summary footer */}
      {assignments.length > 0 && (
        <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between text-xs text-white/30">
          <span>
            {assignments.length} strateg{assignments.length !== 1 ? "ies" : "y"} published
          </span>
          {lastRefresh && (
            <span>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
      )}
    </div>
  );
}
