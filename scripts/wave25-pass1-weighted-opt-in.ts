/**
 * Wave 25 Pass 1 — Weighted Scoring Opt-In Backfill
 *
 * Flips the 3 graduated CANDIDATE strategies (silver_bullet, crt, power_of_3) onto
 * the Wave 25 Path C weighted-scoring dispatcher by setting:
 *
 *   strategies.use_weighted_scoring        = TRUE
 *   strategies.confluence_score_threshold  = 0.72  (DEFAULT_CONFLUENCE_THRESHOLD)
 *   strategies.confluence_score_weights    = NULL  (use code defaults — overfitting guard)
 *
 * The weights column is intentionally left NULL so all 3 strategies use the
 * canonical equal-weight starter table in confluence-score.ts CODE_DEFAULTS.
 * Operators should only override after 30+ days of audit_log instrumentation
 * (see W25.1 module docstring + plan §1 over-fitting guard).
 *
 * Selection criteria (idempotent):
 *   - lifecycle_state = 'CANDIDATE'
 *   - name OR config.entry_indicator contains one of:
 *       silver_bullet | crt | turtle_soup | power_of_3 | power_of_three
 *   - use_weighted_scoring IS FALSE OR NULL (skip already-opted-in)
 *
 * Audit row written per mutation:
 *   action          = "strategy.wave25_weighted_opt_in"
 *   decisionAuthority = "system"
 *   result          = { name, prior_use_weighted_scoring, new_threshold,
 *                       weights_source: "code_defaults",
 *                       archetype_matched: <token>,
 *                       fix_ref: "wave25-pass1-W25.1" }
 *
 * Usage:
 *   npx tsx -r dotenv/config scripts/wave25-pass1-weighted-opt-in.ts          # dry-run
 *   npx tsx -r dotenv/config scripts/wave25-pass1-weighted-opt-in.ts --apply  # mutate
 *
 * Backward-compat:
 *   This script ONLY touches strategies whose use_weighted_scoring is FALSE/NULL.
 *   It NEVER reverts an opted-in strategy. It NEVER touches the 74+ pre-Wave-25
 *   strategies outside the 3 target archetypes — those remain on Path A or B.
 *
 * Out of scope:
 *   - Does not modify entry_quality blocks
 *   - Does not change preferred_regimes or confirming_indicators
 *   - Does not auto-promote graduated → TESTING / PAPER
 */
import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { sql, eq, or, isNull } from "drizzle-orm";
import { DEFAULT_CONFLUENCE_THRESHOLD } from "../src/server/services/confluence-score.js";

const APPLY = process.argv.includes("--apply");
const FIX_REF = "wave25-pass1-W25.1";
const TARGET_ARCHETYPES: Array<{ token: string; aliases: string[] }> = [
  { token: "silver_bullet", aliases: ["silver_bullet", "silver-bullet"] },
  { token: "crt", aliases: ["crt", "turtle_soup"] },
  { token: "power_of_3", aliases: ["power_of_3", "power_of_three"] },
];

function matchArchetype(name: string, entryIndicator: string): string | null {
  const n = (name ?? "").toLowerCase();
  const ind = (entryIndicator ?? "").toLowerCase();
  for (const a of TARGET_ARCHETYPES) {
    if (a.aliases.some((alias) => n.includes(alias) || ind.includes(alias))) {
      return a.token;
    }
  }
  return null;
}

async function main(): Promise<void> {
  console.log("Wave 25 Pass 1 — weighted-scoring opt-in backfill");
  console.log(`Mode: ${APPLY ? "APPLY (will mutate)" : "DRY-RUN (no mutations)"}`);
  console.log(`Default threshold: ${DEFAULT_CONFLUENCE_THRESHOLD}`);
  console.log();

  // Pre-flight: confirm migration 0135 has been applied. The 3 weighted-scoring
  // columns are owned by 0135_strategies_confluence_scoring.sql; if they're
  // absent the boot-migration runner has not yet picked up the migration on this
  // DB instance. Bail with a clear message instead of an opaque drizzle error.
  const colCheck = await db.execute(
    sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies' AND column_name IN ('use_weighted_scoring','confluence_score_threshold','confluence_score_weights')`,
  );
  const presentCols = new Set([...colCheck].map((r) => String((r as { column_name: string }).column_name)));
  const required = ["use_weighted_scoring", "confluence_score_threshold", "confluence_score_weights"];
  const missingCols = required.filter((c) => !presentCols.has(c));
  if (missingCols.length > 0) {
    console.error("❌ Migration 0135_strategies_confluence_scoring.sql NOT applied to this DB.");
    console.error(`   Missing columns on strategies: ${missingCols.join(", ")}`);
    console.error("   Apply the migration first (boot-migration runner or 'npm run db:migrate') and re-run.");
    process.exit(2);
  }

  // Fetch candidates not yet opted-in. We deliberately do NOT filter by
  // lifecycle_state in SQL — the archetype filter is the gate; lifecycle is
  // reported per-row for operator visibility.
  const rows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      lifecycleState: strategies.lifecycleState,
      useWeightedScoring: strategies.useWeightedScoring,
      confluenceScoreThreshold: strategies.confluenceScoreThreshold,
      config: strategies.config,
    })
    .from(strategies)
    .where(
      or(
        eq(strategies.useWeightedScoring, false),
        isNull(strategies.useWeightedScoring),
      ),
    );

  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let skippedAlreadyOptedIn = 0;

  for (const row of rows) {
    scanned++;
    const cfg = (row.config as Record<string, unknown> | null) ?? {};
    const entryIndicator = String(cfg.entry_indicator ?? "");
    const archetype = matchArchetype(row.name ?? "", entryIndicator);
    if (!archetype) continue;
    matched++;

    if (row.useWeightedScoring === true) {
      skippedAlreadyOptedIn++;
      continue; // defensive — SQL filter should have excluded
    }

    const prior = {
      use_weighted_scoring: row.useWeightedScoring ?? false,
      confluence_score_threshold:
        row.confluenceScoreThreshold !== null && row.confluenceScoreThreshold !== undefined
          ? Number(row.confluenceScoreThreshold)
          : null,
    };

    console.log(
      `[${row.lifecycleState}] ${row.name}  archetype=${archetype}  prior_opt_in=${prior.use_weighted_scoring}  → use_weighted_scoring=TRUE threshold=${DEFAULT_CONFLUENCE_THRESHOLD} weights=code_defaults`,
    );

    if (!APPLY) continue;

    await db
      .update(strategies)
      .set({
        useWeightedScoring: true,
        confluenceScoreThreshold: String(DEFAULT_CONFLUENCE_THRESHOLD),
        // confluence_score_weights left as-is (NULL) → evaluator uses CODE_DEFAULTS
      } as never)
      .where(eq(strategies.id, row.id));

    await db.insert(auditLog).values({
      action: "strategy.wave25_weighted_opt_in",
      entityType: "strategy",
      entityId: row.id,
      decisionAuthority: "system",
      status: "success",
      result: {
        name: row.name,
        lifecycle_state: row.lifecycleState,
        archetype_matched: archetype,
        prior_use_weighted_scoring: prior.use_weighted_scoring,
        prior_threshold: prior.confluence_score_threshold,
        new_threshold: DEFAULT_CONFLUENCE_THRESHOLD,
        weights_source: "code_defaults",
        fix_ref: FIX_REF,
      } as Record<string, unknown>,
    });

    updated++;
  }

  console.log();
  console.log("=== Summary ===");
  console.log(`Scanned (not yet opted-in):      ${scanned}`);
  console.log(`Matched target archetypes:       ${matched}`);
  console.log(`Already opted-in (skipped):      ${skippedAlreadyOptedIn}`);
  console.log(`Updated:                         ${updated}${APPLY ? "" : " (dry-run — pass --apply to mutate)"}`);

  // Force-flush via sql.raw to avoid hanging connection in pm2 / NSSM environments.
  await db.execute(sql`SELECT 1`);
  process.exit(0);
}

main().catch((err) => {
  console.error("wave25-pass1-weighted-opt-in failed:", err);
  process.exit(1);
});
