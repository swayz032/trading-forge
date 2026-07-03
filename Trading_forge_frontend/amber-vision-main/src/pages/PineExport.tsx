/**
 * PineExport page — Pass 3 Track B
 *
 * Mounts the PineDistributionPanel on the /pine-export route so the operator
 * can download .pine artifacts from the UI without SSH-ing the tower.
 *
 * Data is loaded from /api/account-strategy-assignments which returns the list
 * of per-recipient assignments. While that endpoint is being built by parallel
 * tracks, the page renders gracefully with an empty list.
 *
 * Visual identity: emerald on near-black, glassy floating cards, top-nav pill.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PineDistributionPanel } from "@/components/forge/PineDistributionPanel";

interface Assignment {
  accountId: string;
  strategyId: string;
  strategyName: string;
  familyMemberLabel: string;
  firmId: string;
  lastExportedAt?: string | null;
  lastArtifactHash?: string | null;
}

interface AssignmentsResponse {
  data: Assignment[];
}

export default function PineExport() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const resp = await fetch("/api/strategy-assignments");
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({})) as { error?: string };
          setFetchError(body.error ?? `HTTP ${resp.status}`);
          return;
        }
        const json = await resp.json() as AssignmentsResponse;
        if (!cancelled) {
          setAssignments(json.data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Network error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="max-w-3xl mx-auto py-8 px-4 space-y-6"
    >
      {/* Page header */}
      <div>
        <h1 className="text-lg font-semibold text-white">Pine Distribution</h1>
        <p className="text-xs text-gray-400 mt-1">
          Generate and download per-recipient <code className="font-mono">.pine</code> files
          for family member TradingView accounts. Each file is sized to the recipient's
          contract count and contains a unique HMAC secret.
        </p>
      </div>

      {fetchError && (
        <div className="rounded-lg bg-red-900/30 border border-red-700/40 px-4 py-3 text-xs text-red-300">
          Failed to load assignments: {fetchError}
        </div>
      )}

      <PineDistributionPanel
        assignments={assignments}
        isLoading={loading}
      />
    </motion.div>
  );
}
