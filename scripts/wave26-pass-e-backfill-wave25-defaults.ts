/**
 * Wave 26 Pass E backfill — bring pre-Pass-E graduated strategies up to Wave 25
 * institutional defaults.
 *
 * What it backfills (only when the field is NULL/FALSE/empty — never reverts an
 * operator's explicit choice):
 *   • use_weighted_scoring → true
 *   • confluence_score_threshold → 0.72
 *   • confluence_score_weights → canonical 11-factor map
 *   • daily_tf / htf_tf / itf_tf / trigger_tf → from exec timeframe
 *   • exit_plan_config → {"exit_style":"adaptive"}
 *   • config.bias_timeframe → htf_tf
 *   • config.confirming_indicators → copy from entry_quality.confluence_factors
 *   • symbols → multi-symbol fan-out (MES/MNQ/MCL) for symbol-agnostic strategies
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/wave26-pass-e-backfill-wave25-defaults.ts          # dry-run
 *   npx tsx -r dotenv/config scripts/wave26-pass-e-backfill-wave25-defaults.ts --apply  # mutate
 *
 * Scope:
 *   Targets only strategies created in the last 7 days from source='graduated_bucket'.
 *   The pre-Wave-26 graduated 74+ strategies remain untouched — they predate
 *   Pass E and the operator already has them where they want them (or has
 *   used wave25-pass1/7-opt-in.ts manually for the ones that should be opted in).
 *
 *   Override via --days=N argument to widen the window.
 */
import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { sql, eq } from "drizzle-orm";
import { applyWave25Defaults } from "../src/server/lib/wave25-strategy-defaults.js";

const APPLY = process.argv.includes("--apply");
const daysArg = process.argv.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Math.max(1, parseInt(daysArg.split("=")[1], 10)) : 7;
const FIX_REF = "wave26-pass-e-backfill";

async function main(): Promise<void> {
  console.log(`[wave26-pass-e-backfill] mode=${APPLY ? "APPLY" : "DRY-RUN"}  window=${DAYS}d\n`);

  // Read candidate strategies
  const rows = await db.execute<{
    id: string;
    name: string;
    symbol: string;
    symbols: string[] | null;
    timeframe: string;
    config: Record<string, unknown> | null;
    use_weighted_scoring: boolean | null;
    confluence_score_threshold: string | null;
    confluence_score_weights: Record<string, number> | null;
    daily_tf: string | null;
    htf_tf: string | null;
    itf_tf: string | null;
    trigger_tf: string | null;
    exit_plan_config: Record<string, unknown> | null;
  }>(sql`
    SELECT id::text, name, symbol, symbols, timeframe, config,
           use_weighted_scoring, confluence_score_threshold::text, confluence_score_weights,
           daily_tf, htf_tf, itf_tf, trigger_tf, exit_plan_config
    FROM strategies
    WHERE created_at > NOW() - (${DAYS}::int * INTERVAL '1 day')
      AND source = 'graduated_bucket'
    ORDER BY created_at ASC
  `);

  const list = (rows as unknown as any[]);
  console.log(`Found ${list.length} candidate strategies in last ${DAYS}d (source='graduated_bucket').\n`);

  let updated = 0;
  let unchanged = 0;
  for (const s of list) {
    const cfg = (s.config ?? {}) as Record<string, unknown>;
    const eq_ = (cfg.entry_quality as Record<string, unknown> | undefined) ?? {};
    const confluenceFactors = Array.isArray(eq_.confluence_factors) ? eq_.confluence_factors as string[] : [];
    const conceptName = String((cfg.metadata as any)?.concept_name ?? s.name);

    const defaults = applyWave25Defaults({
      strategyName: s.name,
      conceptName,
      execTimeframe: s.timeframe,
      originalMarket: (s.symbol as "MES" | "MNQ" | "MCL"),
      confluenceFactors,
    });

    // Build patch — only set fields that are currently NULL/FALSE/empty.
    const patch: Record<string, unknown> = {};
    if (s.use_weighted_scoring !== true) patch.use_weighted_scoring = true;
    if (s.confluence_score_threshold === null || s.confluence_score_threshold === undefined) {
      patch.confluence_score_threshold = String(defaults.confluenceScoreThreshold);
    }
    if (!s.confluence_score_weights || Object.keys(s.confluence_score_weights).length === 0) {
      patch.confluence_score_weights = defaults.confluenceScoreWeights;
    }
    if (!s.daily_tf)   patch.daily_tf   = defaults.dailyTf;
    if (!s.htf_tf)     patch.htf_tf     = defaults.htfTf;
    if (!s.itf_tf)     patch.itf_tf     = defaults.itfTf;
    if (!s.trigger_tf) patch.trigger_tf = defaults.triggerTf;

    const epc = s.exit_plan_config as Record<string, unknown> | null;
    if (!epc || !epc.exit_style) patch.exit_plan_config = defaults.exitPlanConfig;

    // config-JSONB fields
    let configPatch: Record<string, unknown> | null = null;
    if (!cfg.bias_timeframe) {
      configPatch = configPatch ?? {};
      configPatch.bias_timeframe = defaults.configAdditions.bias_timeframe;
    }
    if (!Array.isArray(cfg.confirming_indicators) || (cfg.confirming_indicators as unknown[]).length === 0) {
      configPatch = configPatch ?? {};
      configPatch.confirming_indicators = defaults.configAdditions.confirming_indicators;
    }

    // Symbol routing — two cases:
    //  (1) Symbol-AGNOSTIC concept (inferred=[MES,MNQ,MCL]): expand current set
    //      to all 3 if smaller. Never narrows.
    //  (2) Symbol-SPECIFIC concept (inferred=[MNQ] for nasdaq, [MCL] for oil):
    //      REPLACE current set — concept_name is authoritative over the bucket's
    //      original routing market (which Gemma defaults to MES for everything).
    const currentSyms = Array.isArray(s.symbols) ? s.symbols : [];
    const isAgnostic = defaults.symbols.length >= 3;
    if (isAgnostic && currentSyms.length < defaults.symbols.length) {
      patch.symbols = defaults.symbols;
    } else if (!isAgnostic && (currentSyms.length !== defaults.symbols.length ||
               !defaults.symbols.every((x) => currentSyms.includes(x)))) {
      patch.symbols = defaults.symbols;
    }

    if (Object.keys(patch).length === 0 && !configPatch) {
      unchanged++;
      console.log(`  ✓ ${s.name.padEnd(45)} (already complete)`);
      continue;
    }

    updated++;
    const cols = Object.keys(patch).join(", ");
    const cfgKeys = configPatch ? Object.keys(configPatch).join(", ") : "(none)";
    console.log(`  → ${s.name.padEnd(45)} columns=[${cols}]  config_keys=[${cfgKeys}]`);

    if (APPLY) {
      // Build UPDATE SQL — Drizzle schema doesn't have 5-TF or exit_plan_config
      // fully typed, so use raw SQL for everything except the typed columns.
      const setClauses: string[] = [];
      if (patch.use_weighted_scoring !== undefined) setClauses.push(`use_weighted_scoring = ${patch.use_weighted_scoring}`);
      if (patch.confluence_score_threshold !== undefined) setClauses.push(`confluence_score_threshold = ${patch.confluence_score_threshold}`);
      if (patch.confluence_score_weights !== undefined) setClauses.push(`confluence_score_weights = '${JSON.stringify(patch.confluence_score_weights)}'::jsonb`);
      if (patch.daily_tf !== undefined) setClauses.push(`daily_tf = '${patch.daily_tf}'`);
      if (patch.htf_tf !== undefined) setClauses.push(`htf_tf = '${patch.htf_tf}'`);
      if (patch.itf_tf !== undefined) setClauses.push(`itf_tf = '${patch.itf_tf}'`);
      if (patch.trigger_tf !== undefined) setClauses.push(`trigger_tf = '${patch.trigger_tf}'`);
      if (patch.exit_plan_config !== undefined) setClauses.push(`exit_plan_config = '${JSON.stringify(patch.exit_plan_config)}'::jsonb`);
      if (patch.symbols !== undefined) setClauses.push(`symbols = ARRAY[${(patch.symbols as string[]).map((x) => `'${x}'`).join(",")}]::text[]`);

      // config JSONB merge
      if (configPatch) {
        setClauses.push(`config = config || '${JSON.stringify(configPatch)}'::jsonb`);
      }

      const setClause = setClauses.join(", ");
      await db.execute(sql.raw(`UPDATE strategies SET ${setClause}, updated_at = NOW() WHERE id = '${s.id}'::uuid`));

      // Audit row
      await db.insert(auditLog).values({
        action: "strategy.wave26_pass_e_backfilled",
        entityType: "strategy",
        entityId: s.id,
        input: { strategy_name: s.name } as Record<string, unknown>,
        result: { fix_ref: FIX_REF, patched_columns: Object.keys(patch), patched_config_keys: configPatch ? Object.keys(configPatch) : [] } as Record<string, unknown>,
        status: "success",
        decisionAuthority: "system",
        correlationId: null,
      }).catch((e) => console.warn(`  audit_log insert failed (non-blocking): ${(e as Error).message}`));
    }
  }

  console.log(`\nSummary: ${updated} ${APPLY ? "patched" : "would patch"} / ${unchanged} already complete / ${list.length} total`);
  if (!APPLY) console.log(`\nRe-run with --apply to mutate.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
