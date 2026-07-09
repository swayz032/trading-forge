/**
 * backfill-corpus-timeframes.ts — Timeframe Integrity Fix (2026-07-03)
 *
 * The onboard bug: every `source='spec_onboarding'` strategy was written at a
 * SILENT global "5m" default (onboard-compiled-specs.ts flat `--timeframe ?? "5m"`)
 * regardless of the educator's real timeframe. A 4h swing strategy tested at 5m
 * is a DIFFERENT strategy — it breaks both the edge measurement and the fidelity
 * axis. This script repairs the library deterministically.
 *
 * For each spec_onboarding row it resolves `config.metadata.spec_hash`
 * (fallback: `source_url` → video id) to the compiled `*.spec.json` artifact,
 * recovers the educator's exec (trigger) + higher (context) timeframe via the
 * PURE `recoverSpecTimeframe()`, and UPDATEs:
 *   - strategies.timeframe          → exec_timeframe
 *   - strategies.trigger_tf         → exec_timeframe
 *   - strategies.htf_tf             → higher_timeframe (when present)
 *   - config.strategy.{timeframe,trigger_tf,htf_tf} + config.metadata.timeframe_recovery
 *   - strategies.name               → `_5m` suffix corrected to the real TF
 *
 * THE ONE INVIOLABLE PRINCIPLE — never silently default a timeframe to 5m:
 *   - NEVER overwrites an already-non-5m value (respects prior corrections).
 *   - Ambiguous specs (recoverSpecTimeframe → recovered:false) are QUARANTINED
 *     with a loud `strategy.timeframe_unrecoverable` audit — NOT defaulted.
 *   - Idempotent: a row already carrying the recovered exec on trigger_tf is a
 *     no-op on re-run.
 *
 * Dry-run by default (reports only, mutates nothing). --apply writes + audits.
 * The operator decides whether to --apply after reviewing the dry-run.
 *
 * Standalone run (NO dotenv preload — postgres.js reads DATABASE_URL from env;
 * pass it via --env-file):
 *   node --env-file=.env --import tsx scripts/backfill-corpus-timeframes.ts
 *   node --env-file=.env --import tsx scripts/backfill-corpus-timeframes.ts --apply
 *   node --env-file=.env --import tsx scripts/backfill-corpus-timeframes.ts --specs-dir <path>
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { db } from "../src/server/db/index.js";
import { strategies } from "../src/server/db/schema.js";
import { eq } from "drizzle-orm";
import { recoverSpecTimeframe } from "../src/server/lib/spec-timeframe-recovery.js";
import { insertAuditRowSafe } from "../src/server/lib/audit-log-helper.js";

const DEFAULT_SPECS_DIR = ".claude/worktrees/extraction-100/corpus/specs";

interface Args {
  apply: boolean;
  specsDir: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const idx = argv.indexOf(flag);
    if (idx === -1 || idx + 1 >= argv.length) return null;
    return argv[idx + 1];
  };
  return {
    apply: argv.includes("--apply"),
    specsDir: get("--specs-dir") ?? resolve(process.cwd(), DEFAULT_SPECS_DIR),
  };
}

export interface SpecArtifactLite {
  video: string;
  spec_hash: string;
  spec: unknown;
}

/** Build spec_hash → artifact and video → artifact maps from the corpus dir. */
export function loadSpecMaps(specsDir: string): {
  byHash: Map<string, SpecArtifactLite>;
  byVideo: Map<string, SpecArtifactLite>;
  count: number;
} {
  const byHash = new Map<string, SpecArtifactLite>();
  const byVideo = new Map<string, SpecArtifactLite>();
  if (!existsSync(specsDir)) return { byHash, byVideo, count: 0 };
  const files = readdirSync(specsDir).filter((f) => f.endsWith(".spec.json"));
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(specsDir, f), "utf-8")) as SpecArtifactLite;
      if (typeof raw.spec_hash === "string" && raw.spec_hash.length > 0) byHash.set(raw.spec_hash, raw);
      if (typeof raw.video === "string" && raw.video.length > 0) byVideo.set(raw.video, raw);
    } catch {
      // Skip malformed artifact — reported by count delta.
    }
  }
  return { byHash, byVideo, count: files.length };
}

export function videoFromSourceUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(/[?&]v=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export type RowStatus =
  | "skip_non_5m"
  | "already_backfilled"
  | "unresolved_no_spec"
  | "quarantined"
  | "confirmed_5m"
  | "backfilled";

export interface BackfillRow {
  id: string;
  name: string;
  timeframe: string;
  triggerTf: string | null;
  htfTf: string | null;
  config: unknown;
}

export interface RowPlan {
  id: string;
  name: string;
  oldTimeframe: string;
  status: RowStatus;
  newTimeframe?: string | null;
  higherTimeframe?: string | null;
  newName?: string;
  confidence?: number;
  evidence?: string;
}

/**
 * PURE per-row planning — the whole backfill decision tree in one place, no I/O.
 * Enforces the inviolable principle: NEVER overwrite a non-5m value, QUARANTINE
 * (never default) when the spec's timeframe is unrecoverable, idempotent on re-run.
 */
export function planRowTimeframe(
  row: BackfillRow,
  byHash: Map<string, SpecArtifactLite>,
  byVideo: Map<string, SpecArtifactLite>,
): RowPlan {
  const oldTf = row.timeframe;
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const metadata = (cfg.metadata as Record<string, unknown> | undefined) ?? {};
  const specHash = typeof metadata.spec_hash === "string" ? metadata.spec_hash : null;
  const video = videoFromSourceUrl(metadata.source_url);

  // Respect a prior correction — NEVER overwrite an already-non-5m value.
  if (oldTf !== "5m") {
    return { id: row.id, name: row.name, oldTimeframe: oldTf, status: "skip_non_5m" };
  }

  const artifact = (specHash && byHash.get(specHash)) || (video && byVideo.get(video)) || null;
  if (!artifact) {
    return {
      id: row.id,
      name: row.name,
      oldTimeframe: oldTf,
      status: "unresolved_no_spec",
      evidence: `spec_hash=${specHash ?? "?"} video=${video ?? "?"} not found in corpus`,
    };
  }

  const rec = recoverSpecTimeframe(artifact);
  if (!rec.recovered || !rec.exec_timeframe) {
    return {
      id: row.id,
      name: row.name,
      oldTimeframe: oldTf,
      status: "quarantined",
      evidence: rec.evidence,
      confidence: rec.confidence,
    };
  }

  const exec = rec.exec_timeframe;
  const higher = rec.higher_timeframe;

  // Idempotency: already carries the recovered exec on trigger_tf + htf matches.
  if (row.triggerTf === exec && (row.htfTf ?? null) === (higher ?? null) && (exec !== "5m" ? oldTf === exec : true)) {
    return {
      id: row.id,
      name: row.name,
      oldTimeframe: oldTf,
      status: "already_backfilled",
      newTimeframe: exec,
      higherTimeframe: higher,
    };
  }

  const newName = row.name.replace(/_5m$/, `_${exec}`);
  return {
    id: row.id,
    name: row.name,
    oldTimeframe: oldTf,
    status: exec === "5m" ? "confirmed_5m" : "backfilled",
    newTimeframe: exec,
    higherTimeframe: higher,
    newName,
    confidence: rec.confidence,
    evidence: rec.evidence,
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`${args.apply ? "APPLY" : "DRY RUN"}: corpus timeframe backfill (spec_onboarding rows only)`);
  console.log(`specs dir: ${args.specsDir}`);

  const { byHash, byVideo, count } = loadSpecMaps(args.specsDir);
  console.log(`Loaded ${byHash.size} spec artifact(s) by hash (of ${count} files) from corpus\n`);

  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      timeframe: strategies.timeframe,
      triggerTf: strategies.triggerTf,
      htfTf: strategies.htfTf,
      config: strategies.config,
    })
    .from(strategies)
    .where(eq(strategies.source, "spec_onboarding"));

  console.log(`spec_onboarding strategies: ${rows.length}\n`);

  const plans: RowPlan[] = rows.map((row) => planRowTimeframe(row as BackfillRow, byHash, byVideo));

  // ── Report ────────────────────────────────────────────────────────────────
  const group = (s: RowStatus) => plans.filter((p) => p.status === s);
  const backfilled = group("backfilled");
  const confirmed5m = group("confirmed_5m");
  const quarantined = group("quarantined");
  const skipNon5m = group("skip_non_5m");
  const already = group("already_backfilled");
  const unresolved = group("unresolved_no_spec");

  console.log("=== PROPOSED TIMEFRAME CHANGES (5m → recovered) ===");
  for (const p of backfilled) {
    console.log(
      `  ${p.id}  ${p.oldTimeframe} → ${p.newTimeframe} (htf=${p.higherTimeframe ?? "none"}, conf=${p.confidence?.toFixed(2)})  name: ${p.name} → ${p.newName}`,
    );
  }
  if (backfilled.length === 0) console.log("  (none)");

  console.log("\n=== CONFIRMED 5m (recovered exec IS 5m — provenance stamped, timeframe unchanged) ===");
  for (const p of confirmed5m) console.log(`  ${p.id}  ${p.name}  (htf=${p.higherTimeframe ?? "none"}, conf=${p.confidence?.toFixed(2)})`);
  if (confirmed5m.length === 0) console.log("  (none)");

  console.log("\n=== QUARANTINED (timeframe UNRECOVERABLE — flag for targeted re-extraction, NOT defaulted) ===");
  for (const p of quarantined) console.log(`  ${p.id}  ${p.name}  — ${p.evidence}`);
  if (quarantined.length === 0) console.log("  (none)");

  console.log("\n=== UNRESOLVED (no matching spec artifact in corpus — left untouched) ===");
  for (const p of unresolved) console.log(`  ${p.id}  ${p.name}  — ${p.evidence}`);
  if (unresolved.length === 0) console.log("  (none)");

  console.log(
    `\nSummary: ${rows.length} spec_onboarding rows | ${backfilled.length} to backfill | ${confirmed5m.length} confirmed-5m | ` +
      `${quarantined.length} quarantined | ${already.length} already-backfilled | ${skipNon5m.length} skip-non-5m | ${unresolved.length} unresolved`,
  );

  if (!args.apply) {
    console.log("\nDRY RUN complete — nothing written. Re-run with --apply after review (operator decision).");
    return 0;
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  console.log("\nAPPLY: writing timeframe corrections + audits...");
  let updated = 0;
  const rowsById = new Map(rows.map((r) => [r.id, r]));

  for (const p of plans) {
    if (p.status === "quarantined") {
      await insertAuditRowSafe({
        action: "strategy.timeframe_unrecoverable",
        entityType: "strategy",
        entityId: p.id,
        status: "warning",
        input: { name: p.name },
        result: { evidence: p.evidence, confidence: p.confidence },
        decisionAuthority: "gate",
      });
      continue;
    }
    if (p.status !== "backfilled" && p.status !== "confirmed_5m") continue;

    const row = rowsById.get(p.id);
    if (!row) continue;
    const exec = p.newTimeframe as string;
    const higher = p.higherTimeframe ?? null;

    // Deep-clone config and stamp the multi-TF fields + recovery provenance.
    const cfg = JSON.parse(JSON.stringify(row.config ?? {})) as Record<string, unknown>;
    const strat = (cfg.strategy && typeof cfg.strategy === "object" ? cfg.strategy : {}) as Record<string, unknown>;
    strat.timeframe = exec;
    strat.trigger_tf = exec;
    if (higher) strat.htf_tf = higher;
    else delete strat.htf_tf;
    cfg.strategy = strat;
    const meta = (cfg.metadata && typeof cfg.metadata === "object" ? cfg.metadata : {}) as Record<string, unknown>;
    meta.timeframe_recovery = {
      exec_timeframe: exec,
      higher_timeframe: higher,
      source: "backfill_recovered_from_spec",
      confidence: p.confidence,
      evidence: p.evidence,
      backfilled_from: p.oldTimeframe,
    };
    cfg.metadata = meta;

    await db
      .update(strategies)
      .set({
        timeframe: exec,
        triggerTf: exec,
        htfTf: higher,
        name: p.newName ?? row.name,
        config: cfg,
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, p.id));

    await insertAuditRowSafe({
      action: "strategy.timeframe_backfilled",
      entityType: "strategy",
      entityId: p.id,
      status: "success",
      input: { old_timeframe: p.oldTimeframe, old_name: row.name },
      result: {
        new_timeframe: exec,
        higher_timeframe: higher,
        new_name: p.newName,
        confidence: p.confidence,
        evidence: p.evidence,
      },
      decisionAuthority: "gate",
    });
    updated++;
  }

  console.log(
    `\nAPPLY complete. ${updated} rows updated; ${quarantined.length} quarantined (audit only). ` +
      `Quarantined strategies need targeted timeframe re-extraction.`,
  );
  return 0;
}

// Only auto-run when invoked directly (guards test imports of planRowTimeframe).
const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("backfill-corpus-timeframes.ts fatal error:", err);
      process.exit(1);
    });
}
