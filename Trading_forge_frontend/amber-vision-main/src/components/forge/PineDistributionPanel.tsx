/**
 * PineDistributionPanel — Track 6 / Pass 2 (updated Pass 3 Track B)
 *
 * Operator-side UI for per-recipient Pine export distribution.
 *
 * Shows:
 *   - List of assigned strategies from Track 5 account_strategy_assignments
 *   - "Generate Pine for [Family Member]" button per assignment
 *   - Last delivery timestamp per assignment
 *   - Download bundle button (triggers /api/pine-export/recipient)
 *   - Download .pine button (GETs /api/pine-export/:exportId/artifacts/:artifactId/download)
 *
 * Visual identity: emerald (#10B981) on near-black, glassy floating card, top-nav pill style.
 * No marketing copy. No sidebar.
 *
 * Pass 3 Track B additions:
 *   - downloadUrl prop on RecipientExportButton (propagated by Track A route)
 *   - Download .pine button: same-origin blob fetch + URL.createObjectURL trigger
 *   - Loading state during download + error toast on failure
 */

import { useState } from "react";
import { toast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Assignment {
  accountId: string;
  strategyId: string;
  strategyName: string;
  familyMemberLabel: string;
  firmId: string;
  lastExportedAt?: string | null;
  lastArtifactHash?: string | null;
}

interface GenerateResult {
  artifact_path: string;
  artifact_hash: string;
  export_id: string | null;
  artifact_id?: string | null;
  recipient_label: string;
  qty: number;
  setup_readme: string;
  presigned_url: string | null;
  /** Populated by Track A route propagation — null until Track A merges */
  downloadUrl?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string | null | undefined): string {
  if (!ts) return "Never";
  try {
    return new Date(ts).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function hashShort(hash: string | null | undefined): string {
  if (!hash) return "—";
  return hash.slice(0, 8) + "…";
}

// ─── Generate + Download Button Component ─────────────────────────────────────

function RecipientExportButton({ assignment, apiBase }: {
  assignment: Assignment;
  apiBase: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pineDownloading, setPineDownloading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resp = await fetch(`${apiBase}/api/pine-export/recipient`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy_id: assignment.strategyId,
          account_id: assignment.accountId,
        }),
      });

      if (resp.status === 423) {
        setError("Pipeline is paused — resume pipeline before generating exports.");
        return;
      }
      if (resp.status === 403) {
        setError("Account not on a supported firm (MFFU or Topstep only).");
        return;
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? `HTTP ${resp.status}`);
        return;
      }

      const data = await resp.json() as GenerateResult;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  function handleDownloadReadme() {
    if (!result) return;
    const blob = new Blob([result.setup_readme], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.recipient_label}_SETUP_README.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Download the .pine artifact from the server.
   *
   * Uses the downloadUrl propagated by Track A route. The URL is a same-origin
   * proxy path that injects OPERATOR_API_KEY server-side — no Authorization
   * header needed from the browser.
   *
   * Pattern: blob fetch + URL.createObjectURL (mirrors handleDownloadReadme above).
   */
  async function handleDownloadPine() {
    if (!result?.downloadUrl) return;
    setPineDownloading(true);
    try {
      const resp = await fetch(result.downloadUrl);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        const msg = body.error ?? `HTTP ${resp.status}`;
        toast({ title: "Download failed", description: msg, variant: "destructive" });
        return;
      }
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `${result.recipient_label}.pine`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      toast({ title: "Download failed", description: msg, variant: "destructive" });
    } finally {
      setPineDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={handleGenerate}
        disabled={loading}
        className={[
          "px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
          loading
            ? "bg-gray-700 text-gray-400 cursor-not-allowed"
            : "bg-emerald-600 hover:bg-emerald-500 text-white",
        ].join(" ")}
      >
        {loading ? "Generating…" : `Generate Pine for ${assignment.familyMemberLabel}`}
      </button>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {result && (
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-emerald-400">
              {result.qty} contracts
            </span>
            <span className="text-xs text-gray-400 font-mono">
              hash: {hashShort(result.artifact_hash)}
            </span>
            <button
              onClick={handleDownloadReadme}
              className="px-2 py-0.5 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200"
            >
              Download README
            </button>
            {/* Download .pine button — enabled only when downloadUrl is non-null (Track A propagation) */}
            {result.downloadUrl != null && (
              <button
                onClick={handleDownloadPine}
                disabled={pineDownloading}
                aria-label="Download .pine file"
                data-testid="download-pine-btn"
                className={[
                  "px-2 py-0.5 rounded text-xs font-semibold transition-all",
                  pineDownloading
                    ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                    : "bg-emerald-700 hover:bg-emerald-600 text-white",
                ].join(" ")}
              >
                {pineDownloading ? "Downloading…" : "Download .pine"}
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500">
            Bundle saved to server — hand-deliver via secure messaging.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface PineDistributionPanelProps {
  assignments: Assignment[];
  apiBase?: string;
  isLoading?: boolean;
}

export function PineDistributionPanel({
  assignments,
  apiBase = "",
  isLoading = false,
}: PineDistributionPanelProps) {
  if (isLoading) {
    return (
      <div className="rounded-xl bg-gray-900/80 border border-gray-800 p-5 backdrop-blur-sm">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-700 rounded w-1/3" />
          <div className="h-8 bg-gray-700 rounded" />
          <div className="h-8 bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div className="rounded-xl bg-gray-900/80 border border-gray-800 p-5 backdrop-blur-sm">
        <h3 className="text-sm font-semibold text-gray-300 mb-1">Pine Distribution</h3>
        <p className="text-xs text-gray-500">
          No strategy assignments found. Assign strategies to accounts first (Strategy Assignment Matrix).
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-gray-900/80 border border-gray-800 p-5 backdrop-blur-sm space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Pine Distribution</h3>
        <span className="text-xs text-gray-500">{assignments.length} assignment{assignments.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Assignment rows */}
      <div className="space-y-3">
        {assignments.map((asgn) => (
          <div
            key={`${asgn.accountId}-${asgn.strategyId}`}
            className="rounded-lg bg-gray-800/60 border border-gray-700/40 p-3 space-y-2"
          >
            {/* Row header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-white">{asgn.familyMemberLabel}</p>
                <p className="text-xs text-gray-400">{asgn.strategyName}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={[
                  "text-xs px-1.5 py-0.5 rounded font-mono",
                  asgn.firmId === "mffu" ? "bg-blue-900/40 text-blue-300" : "bg-purple-900/40 text-purple-300",
                ].join(" ")}>
                  {asgn.firmId.toUpperCase()}
                </span>
              </div>
            </div>

            {/* Last export info */}
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>Last export: {formatTimestamp(asgn.lastExportedAt)}</span>
              {asgn.lastArtifactHash && (
                <span className="font-mono">hash: {hashShort(asgn.lastArtifactHash)}</span>
              )}
            </div>

            {/* Generate button */}
            <RecipientExportButton assignment={asgn} apiBase={apiBase} />
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p className="text-xs text-gray-600">
        Each export is tailored to the recipient's contract count and includes a unique HMAC secret.
        Bundles are saved to the server and must be hand-delivered via secure messaging.
      </p>
    </div>
  );
}

export default PineDistributionPanel;
