/**
 * EvidenceSummaryCard — top-of-tab summary for cross-validation provenance.
 *
 * Renders the big "{source_count} / 3 required" number, a status pill,
 * the bucket short hash and key timestamps. Glassy forge-card per the
 * visual identity rules (emerald primary, no marketing copy).
 */

import { ShieldCheck, ShieldAlert } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import type { EvidenceBucket } from "@/types/strategy-evidence";

interface Props {
  bucket: EvidenceBucket;
  crossValidated: boolean;
}

export function EvidenceSummaryCard({ bucket, crossValidated }: Props) {
  const target = 3;
  const count = bucket.source_count;
  const pct = Math.min(100, Math.round((count / target) * 100));
  const shortHash = bucket.fingerprint_hash.slice(0, 8);

  return (
    <div
      data-testid="evidence-summary-card"
      className="forge-card p-5"
    >
      <div className="flex items-start gap-6">
        {/* Big count */}
        <div className="flex flex-col items-center justify-center min-w-[120px]">
          <span className="text-[10px] uppercase tracking-widest text-text-muted mb-1">
            Sources
          </span>
          <div className="flex items-baseline gap-1">
            <span
              className={`text-4xl font-mono font-bold ${
                crossValidated ? "text-primary" : "text-amber-300"
              }`}
            >
              {count}
            </span>
            <span className="text-sm font-mono text-text-muted">
              / {target}
            </span>
          </div>
          <div className="w-full h-1 rounded-full bg-[hsl(var(--surface-2))] mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                crossValidated ? "bg-primary" : "bg-amber-400/60"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Status + facts */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            {crossValidated ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-primary/10 text-primary border border-primary/20">
                <ShieldCheck className="w-3 h-3" />
                Cross-validated
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-400/10 text-amber-300 border border-amber-400/20">
                <ShieldAlert className="w-3 h-3" />
                Pre-cross-validation
              </span>
            )}
            <span className="text-[10px] uppercase tracking-widest text-text-muted">
              {bucket.status}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Fingerprint" mono value={shortHash} />
            <Field label="Market" value={bucket.market} />
            <Field label="Entry" value={bucket.entry_archetype} />
            <Field label="Exit" value={bucket.exit_type} />
            <Field
              label="First seen"
              value={timeAgo(bucket.first_seen_at)}
            />
            <Field
              label="Last seen"
              value={timeAgo(bucket.last_seen_at)}
            />
            <Field
              label="Distinct providers"
              mono
              value={String(bucket.distinct_providers)}
            />
            <Field
              label="Graduated"
              value={
                bucket.graduated_at ? timeAgo(bucket.graduated_at) : "—"
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-text-muted block">
        {label}
      </span>
      <span
        className={`text-xs ${
          mono ? "font-mono" : ""
        } text-foreground truncate block`}
      >
        {value}
      </span>
    </div>
  );
}
