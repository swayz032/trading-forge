import { memo } from "react";
import { motion } from "framer-motion";
import { ExternalLink, Calendar, Award } from "lucide-react";
import { TiltCard, TiltLayer } from "@/components/ui/tilt-card";
import { ForgeScoreRing } from "@/components/forge/ForgeScoreRing";
import {
  describeDrawdown,
  describeProfitFactor,
  describeSharpe,
  describeWinRate,
  keyTakeaway,
  simplifyAnalystNotes,
  simplifyPrompt,
  simplifyTitle,
  summarizePropCompliance,
  verdictFromEntry,
  verdictMeta,
} from "@/lib/journalTranslate";
import { num, timeAgo } from "@/lib/utils";
import type { JournalEntry } from "@/types/api";

interface Props {
  entry: JournalEntry;
  expanded: boolean;
  onToggle: () => void;
  size?: "compact" | "tall" | "wide" | "feature";
}

const VERDICT_COLOR: Record<string, string> = {
  profit: "text-profit border-profit/30 bg-profit/8",
  emerald: "text-emerald border-emerald-500/30 bg-emerald-500/8",
  amber: "text-emerald border-emerald-500/35 bg-emerald-500/12",
  loss: "text-loss border-loss/30 bg-loss/8",
  info: "text-info border-info/30 bg-info/8",
  neutral: "text-text-muted border-border/30 bg-surface-2",
};

const RAIL_COLOR: Record<string, string> = {
  profit: "linear-gradient(180deg, hsl(142 71% 45%), transparent)",
  emerald: "linear-gradient(180deg, hsl(160 84% 39%), transparent)",
  amber: "linear-gradient(180deg, hsl(160 84% 50%), transparent)",
  loss: "linear-gradient(180deg, hsl(0 84% 60%), transparent)",
  info: "linear-gradient(180deg, hsl(217 91% 60%), transparent)",
  neutral: "linear-gradient(180deg, hsl(220 5% 47%), transparent)",
};

function JournalCardInner({ entry, expanded, onToggle, size = "compact" }: Props) {
  const v = verdictFromEntry(entry);
  const meta = verdictMeta(v);
  const tone = meta.tone;

  const params = entry.strategyParams ?? {};
  const perf = entry.performanceGateResult ?? {};
  const score = num(entry.forgeScore);

  const rawTitle =
    params.title ??
    params.name ??
    (entry.generationPrompt ? entry.generationPrompt.slice(0, 60) : null) ??
    `Strategy #${entry.strategyId?.slice(0, 6) ?? entry.id.slice(0, 6)}`;
  const title = simplifyTitle(rawTitle);
  const takeaway = keyTakeaway(entry);

  const sharpe = num(perf.sharpe ?? params.sharpe);
  const winRate = num(perf.winRate ?? params.winRate);
  const profitFactor = num(perf.profitFactor ?? params.profitFactor);
  const maxDD = perf.maxDrawdown ?? params.maxDrawdown ?? null;
  const ddIsPercent = typeof maxDD === "number" && Math.abs(maxDD) <= 1;

  const sharpeDesc = describeSharpe(sharpe);
  const winDesc = describeWinRate(winRate);
  const pfDesc = describeProfitFactor(profitFactor);
  const ddDesc = describeDrawdown(num(maxDD), ddIsPercent);

  const url = params.url ?? params.source_url ?? null;
  const symbol = params.symbol ?? (Array.isArray(params.instruments) ? params.instruments[0] : null);
  const timeframe = params.timeframe ?? null;
  const tags: string[] = Array.isArray(params.indicators)
    ? params.indicators.slice(0, 4)
    : Array.isArray(entry.strategyParams?.tags)
    ? entry.strategyParams.tags.slice(0, 4)
    : [];

  // Bento sizing — different aspect ratios for visual rhythm
  const sizeClasses =
    size === "feature"
      ? "md:col-span-2 md:row-span-2 min-h-[320px]"
      : size === "tall"
      ? "md:row-span-2 min-h-[300px]"
      : size === "wide"
      ? "md:col-span-2 min-h-[200px]"
      : "min-h-[200px]";

  const isFeature = size === "feature" || size === "tall";
  const isTier1 = entry.tier === "TIER_1";

  return (
    <motion.div
      layout
      className={sizeClasses}
      initial={{ opacity: 0, y: 16, rotateX: -4 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
    >
      <TiltCard
        glow={isTier1 || isFeature}
        intensity={isFeature ? 8 : 5}
        className="relative h-full p-0 overflow-hidden"
        onClick={onToggle}
      >
        {/* Status accent rail */}
        <div
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[3px] z-10 pointer-events-none"
          style={{ background: RAIL_COLOR[tone] ?? RAIL_COLOR.neutral }}
        />

        {/* Soft tone wash — adds the "sticker note" feel */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              tone === "profit" ? "radial-gradient(circle at 80% -10%, hsl(142 71% 45% / 0.10), transparent 55%)"
              : tone === "emerald" ? "radial-gradient(circle at 80% -10%, hsl(160 84% 39% / 0.12), transparent 55%)"
              : tone === "amber" ? "radial-gradient(circle at 80% -10%, hsl(160 84% 50% / 0.10), transparent 55%)"
              : tone === "loss" ? "radial-gradient(circle at 80% -10%, hsl(0 84% 60% / 0.10), transparent 55%)"
              : tone === "info" ? "radial-gradient(circle at 80% -10%, hsl(217 91% 60% / 0.10), transparent 55%)"
              : "transparent",
          }}
        />

        <div className="relative z-10 p-5 h-full flex flex-col">
          {/* Verdict pill + meta */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-medium ${VERDICT_COLOR[tone] ?? VERDICT_COLOR.neutral}`}>
              <span className="leading-none">{meta.icon}</span>
              <span>{meta.label}</span>
            </div>
            <span className="text-[10px] text-text-muted whitespace-nowrap">
              {timeAgo(entry.createdAt)}
            </span>
          </div>

          {/* Title row with floating score ring */}
          <div className="flex items-start gap-3 mb-2">
            <TiltLayer depth={isFeature ? 50 : 30} className="shrink-0">
              <ForgeScoreRing score={score} size={isFeature ? 64 : 44} strokeWidth={4} label="" />
            </TiltLayer>
            <div className="min-w-0 flex-1">
              <TiltLayer depth={isFeature ? 30 : 20}>
                <h3 className={`font-semibold text-foreground tracking-tight ${isFeature ? "text-lg" : "text-sm"} line-clamp-2`}>
                  {title}
                </h3>
              </TiltLayer>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                {symbol && (
                  <Sticker color="emerald">{symbol}</Sticker>
                )}
                {timeframe && (
                  <Sticker color="info">{timeframe}</Sticker>
                )}
                {entry.tier && entry.tier !== "REJECTED" && (
                  <Sticker color={entry.tier === "TIER_1" ? "profit" : "emerald"}>
                    {entry.tier.replace("_", " ")}
                  </Sticker>
                )}
                <Sticker color="neutral">{entry.source}</Sticker>
              </div>
            </div>
          </div>

          {/* Plain-English takeaway — the AI text, simplified */}
          <p className={`text-text-secondary leading-relaxed ${isFeature ? "text-sm" : "text-xs"} mb-3`}>
            {takeaway}
          </p>

          {/* Plain-English metric chips (only when entry has perf data) */}
          {(sharpeDesc || winDesc || pfDesc || ddDesc) && (
            <div className="flex flex-wrap gap-1.5 mb-3 mt-auto">
              {sharpeDesc && <PlainMetric label="Consistency" value={sharpeDesc.shortLabel} tone={sharpe >= 1.5 ? "profit" : "neutral"} />}
              {winDesc && <PlainMetric label="Win cadence" value={winDesc.shortLabel} tone={winRate >= 0.6 ? "profit" : "neutral"} />}
              {pfDesc && <PlainMetric label="Win/loss math" value={pfDesc.shortLabel} tone={profitFactor >= 2 ? "profit" : "neutral"} />}
              {ddDesc && <PlainMetric label="Worst dip" value={ddDesc.shortLabel} tone="neutral" />}
            </div>
          )}

          {/* Expanded body */}
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="border-t border-border/15 pt-3 mt-3 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Source URL for scouted entries */}
              {url && typeof url === "string" && (
                <div className="flex items-center gap-2 text-[11px]">
                  <ExternalLink className="w-3 h-3 text-emerald" />
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald hover:text-emerald-deep underline underline-offset-2 truncate"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {url}
                  </a>
                </div>
              )}

              {/* AI analyst notes — simplified */}
              {entry.analystNotes && (
                <div className="rounded-lg bg-surface-2/40 border border-emerald-500/10 p-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Award className="w-3 h-3 text-emerald" />
                    <span className="text-[10px] uppercase tracking-widest text-text-muted">
                      AI take
                    </span>
                  </div>
                  <p className="text-[11px] text-text-secondary leading-relaxed">
                    {simplifyAnalystNotes(entry.analystNotes)}
                  </p>
                </div>
              )}

              {/* Indicator chips */}
              {tags.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-text-muted mb-1.5">
                    Uses
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <Sticker key={t} color="info">{t}</Sticker>
                    ))}
                  </div>
                </div>
              )}

              {/* Plain-language metrics */}
              {(sharpeDesc || winDesc || pfDesc || ddDesc) && (
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {sharpeDesc && <DescRow label="Consistency" desc={sharpeDesc.describes} />}
                  {winDesc && <DescRow label="Win rate" desc={winDesc.describes} />}
                  {pfDesc && <DescRow label="Win/loss math" desc={pfDesc.describes} />}
                  {ddDesc && <DescRow label="Drawdown" desc={ddDesc.describes} />}
                </div>
              )}

              {/* Prop firm summary */}
              {entry.propComplianceResults && (
                <p className="text-[11px] text-text-secondary">
                  {summarizePropCompliance(entry.propComplianceResults)}
                </p>
              )}

              {/* Generation prompt — simplified */}
              {entry.generationPrompt && (
                <div className="text-[11px] text-text-muted">
                  <span className="text-text-secondary font-medium">Asked: </span>
                  {simplifyPrompt(entry.generationPrompt)}
                </div>
              )}

              {/* Created stamp */}
              <div className="flex items-center gap-1.5 text-[10px] text-text-muted/70 pt-2 border-t border-border/10">
                <Calendar className="w-3 h-3" />
                {new Date(entry.createdAt).toLocaleString()}
              </div>
            </motion.div>
          )}
        </div>
      </TiltCard>
    </motion.div>
  );
}

function Sticker({
  children,
  color = "neutral",
}: {
  children: React.ReactNode;
  color?: "emerald" | "info" | "profit" | "loss" | "neutral";
}) {
  const cls =
    color === "emerald" ? "bg-emerald-500/12 text-emerald border-emerald-500/30"
    : color === "info" ? "bg-info/10 text-info border-info/25"
    : color === "profit" ? "bg-profit/10 text-profit border-profit/30"
    : color === "loss" ? "bg-loss/10 text-loss border-loss/30"
    : "bg-surface-2 text-text-secondary border-border/30";
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${cls}`}>
      {children}
    </span>
  );
}

function PlainMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "profit" | "neutral";
}) {
  const cls = tone === "profit" ? "text-profit" : "text-foreground";
  return (
    <div className="rounded-lg px-2.5 py-1 bg-surface-2/40 border border-border/15">
      <p className="text-[8px] uppercase tracking-widest text-text-muted leading-tight">
        {label}
      </p>
      <p className={`text-[11px] font-medium leading-tight mt-0.5 ${cls}`}>
        {value}
      </p>
    </div>
  );
}

function DescRow({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="rounded-lg px-2.5 py-1.5 bg-surface-2/30 border border-border/10">
      <p className="text-[9px] uppercase tracking-widest text-text-muted">{label}</p>
      <p className="text-[11px] text-text-secondary leading-snug mt-0.5">{desc}</p>
    </div>
  );
}

export const JournalCard = memo(JournalCardInner);
