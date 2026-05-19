/**
 * PendingBucketRow — one row in the Pending Validation Watchlist.
 *
 * Single responsibility: render bucket summary + action buttons, expose
 * collapsible source-mentions panel. Mutations are isolated to this row so
 * an in-flight kill / graduate doesn't block other rows.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useGraduateBucket,
  useKillBucket,
} from "@/hooks/usePendingBuckets";
import type { PendingBucket, PendingMarket } from "@/types/pending-buckets";
import { timeAgo } from "@/lib/utils";
import { PendingMentionsList } from "./PendingMentionsList";

const SOURCE_TARGET = 3;

/**
 * Per-market brand accent. Emerald is reserved for the primary action; each
 * market keeps a single signature hue per the operator visual identity rules.
 */
const MARKET_STYLES: Record<PendingMarket, { ring: string; text: string; bg: string }> = {
  MES: {
    ring: "border-amber-400/40",
    text: "text-amber-300",
    bg: "bg-amber-400/10",
  },
  MNQ: {
    ring: "border-cyan-400/40",
    text: "text-cyan-300",
    bg: "bg-cyan-400/10",
  },
  MCL: {
    ring: "border-orange-400/40",
    text: "text-orange-300",
    bg: "bg-orange-400/10",
  },
};

interface Props {
  bucket: PendingBucket;
  index?: number;
}

export function PendingBucketRow({ bucket, index = 0 }: Props) {
  const [expanded, setExpanded] = useState(false);
  const graduate = useGraduateBucket();
  const kill = useKillBucket();

  const mutating = graduate.isPending || kill.isPending;
  const market = (bucket.market in MARKET_STYLES
    ? bucket.market
    : "MES") as PendingMarket;
  const style = MARKET_STYLES[market];

  const count = Math.min(bucket.sourceCount, SOURCE_TARGET);
  const progressPct = Math.min(
    100,
    Math.round((bucket.sourceCount / SOURCE_TARGET) * 100),
  );
  const isComplete = bucket.sourceCount >= SOURCE_TARGET;

  return (
    <motion.div
      data-testid={`pending-bucket-row-${bucket.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="forge-card overflow-hidden"
    >
      <div className="p-5 flex items-start gap-5">
        {/* Market badge */}
        <div
          className={`w-[60px] h-[60px] rounded-full flex flex-col items-center justify-center border-2 ${style.ring} ${style.bg}`}
        >
          <span className={`text-sm font-mono font-semibold ${style.text}`}>
            {market}
          </span>
          <span className="text-[9px] uppercase tracking-widest text-text-muted leading-none mt-0.5">
            futures
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <h3 className="text-sm font-medium text-foreground truncate">
              {bucket.entryArchetype}
              <span className="text-text-muted mx-1.5">→</span>
              <span className="text-text-secondary">{bucket.exitType}</span>
            </h3>
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-text-muted hover:text-foreground transition-colors text-xs flex items-center gap-1 flex-shrink-0"
              aria-label={expanded ? "Hide mentions" : "View mentions"}
              aria-expanded={expanded}
            >
              {expanded ? "Hide mentions" : "View mentions"}
              {expanded ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Progress bar */}
          <div
            className="flex items-center gap-2 mb-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={SOURCE_TARGET}
            aria-valuenow={count}
            aria-label="Cross-source consensus progress"
          >
            <div className="flex-1 h-1.5 rounded-full bg-[hsl(var(--surface-2))] overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  isComplete ? "bg-primary" : "bg-primary/40"
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-text-secondary tabular-nums">
              {bucket.sourceCount}/{SOURCE_TARGET}
            </span>
          </div>

          {/* Source chips + age */}
          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            {bucket.providers.length === 0 ? (
              <span className="text-[10px] text-text-muted italic">
                no sources yet
              </span>
            ) : (
              bucket.providers.map((p) => (
                <span
                  key={p}
                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-[hsl(var(--surface-2))] text-text-muted border border-border/20"
                >
                  {p}
                </span>
              ))
            )}
            <span className="text-[10px] text-text-muted ml-auto">
              first seen {timeAgo(bucket.firstSeenAt)}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Force graduate */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={mutating}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  data-testid={`graduate-trigger-${bucket.id}`}
                >
                  {graduate.isPending && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  Force graduate
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Force-graduate this bucket?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This promotes the bucket to the strict scout pipeline with{" "}
                    {bucket.sourceCount} of {SOURCE_TARGET} required sources.
                    The strategy will enter the lifecycle as if it had reached
                    full cross-source consensus. Operator override — use with
                    care.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => graduate.mutate(bucket.id)}
                    data-testid={`graduate-confirm-${bucket.id}`}
                  >
                    Graduate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* Kill */}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  disabled={mutating}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-rose-900/40 text-rose-200 border border-rose-800/40 hover:bg-rose-900/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  data-testid={`kill-trigger-${bucket.id}`}
                >
                  {kill.isPending && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  Kill
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Kill this bucket?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Marks the bucket as <span className="font-mono">killed</span>{" "}
                    so future scouts ignore it. This cannot be undone from the
                    UI — the bucket will need to be re-discovered organically.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => kill.mutate(bucket.id)}
                    data-testid={`kill-confirm-${bucket.id}`}
                    className="bg-rose-800 hover:bg-rose-700 focus:ring-rose-700"
                  >
                    Kill bucket
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {bucket.status !== "pending" && (
              <span className="text-[10px] uppercase tracking-widest text-text-muted ml-auto">
                {bucket.status}
              </span>
            )}
          </div>
        </div>
      </div>

      {expanded && <PendingMentionsList bucketId={bucket.id} />}
    </motion.div>
  );
}
