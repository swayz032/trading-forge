/**
 * wave23f-relegacy-overlay.ts — Wave 23F Track F (one-shot)
 *
 * Re-applies applyFrameworkOverlay() to the two legacy strategies that pre-date
 * Wave 23F and therefore lack an entry_quality block.  Without this script,
 * paper-signal-service.ts's A+ confluence gate crashes (or silently rejects every
 * signal) when it tries to read entry_quality.confluence_factors on these rows.
 *
 * Strategies targeted (by name, archived_at IS NULL):
 *   - orb_15m_mes
 *   - ema_9_21_pullback_mes_5m
 *
 * What the script writes per row:
 *   1. Re-runs applyFrameworkOverlay() on the existing config (idempotent).
 *   2. Merges entry_quality with extraction_provenance="legacy_no_confluence",
 *      confluence_factors=[], min_factors_satisfied=0 — the same shape that
 *      W23F.D graduator emits for zero-confluence strategies.  The A+ gate
 *      bypasses rows carrying legacy_no_confluence provenance.
 *   3. Ensures symbols=['MES'] (verifies without overwriting if already correct).
 *   4. Writes one audit_log row per strategy (action="strategy.legacy_overlay_applied").
 *
 * Idempotent: re-running the script produces no net DB change on already-patched rows
 * because (a) applyFrameworkOverlay is itself idempotent, and (b) the entry_quality
 * block deep-equality check short-circuits the UPDATE when nothing changed.
 *
 * Usage:
 *   npx tsx scripts/wave23f-relegacy-overlay.ts
 *   npx tsx scripts/wave23f-relegacy-overlay.ts --dry-run
 */

import "dotenv/config";
import { db } from "../src/server/db/index.js";
import { strategies, auditLog } from "../src/server/db/schema.js";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { applyFrameworkOverlay } from "../src/server/services/framework-overlay.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type EntryQualityBlock = {
  confluence_factors: string[];
  min_factors_satisfied: number;
  source_claim_win_rate: number | null;
  source_claim_avg_r: number | null;
  extraction_provenance: string;
};

const LEGACY_ENTRY_QUALITY: EntryQualityBlock = {
  confluence_factors: [],
  min_factors_satisfied: 0,
  source_claim_win_rate: null,
  source_claim_avg_r: null,
  extraction_provenance: "legacy_no_confluence",
};

const LEGACY_STRATEGY_NAMES = ["orb_15m_mes", "ema_9_21_pullback_mes_5m"] as const;
const EXPECTED_SYMBOLS = ["MES"];

const isDryRun = process.argv.includes("--dry-run");

// ─── Deep equality helper (for idempotency check) ────────────────────────────

function entryQualityMatches(existing: unknown): boolean {
  if (!existing || typeof existing !== "object") return false;
  const eq = existing as Record<string, unknown>;
  return (
    Array.isArray(eq.confluence_factors) &&
    eq.confluence_factors.length === 0 &&
    eq.min_factors_satisfied === 0 &&
    eq.source_claim_win_rate === null &&
    eq.source_claim_avg_r === null &&
    eq.extraction_provenance === "legacy_no_confluence"
  );
}

function symbolsMatch(existing: unknown): boolean {
  if (!Array.isArray(existing)) return false;
  const arr = existing as string[];
  return arr.length === EXPECTED_SYMBOLS.length && arr.every((s, i) => s === EXPECTED_SYMBOLS[i]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Wave 23F Track F — Legacy overlay re-application ${isDryRun ? "[DRY RUN]" : "[LIVE]"}`);
  console.log(`Targeting strategies: ${LEGACY_STRATEGY_NAMES.join(", ")}`);
  console.log();

  const activeRows = await db
    .select({
      id: strategies.id,
      name: strategies.name,
      symbol: strategies.symbol,
      symbols: strategies.symbols,
      config: strategies.config,
      source: strategies.source,
      lifecycleState: strategies.lifecycleState,
    })
    .from(strategies)
    .where(
      and(
        inArray(strategies.name, [...LEGACY_STRATEGY_NAMES]),
        isNull(strategies.archivedAt),
      )
    );

  if (activeRows.length === 0) {
    console.log("No matching active legacy strategies found. Nothing to do.");
    return;
  }

  console.log(`Found ${activeRows.length} strategy row(s) to process:`);
  activeRows.forEach((r: any) => console.log(`  - ${r.name} (${r.id}) [${r.lifecycleState}]`));
  console.log();

  let updated = 0;
  let alreadyCorrect = 0;

  for (const row of activeRows) {
    const config = row.config as Record<string, unknown>;
    const existingEntryQuality = (config as any)?.entry_quality;
    const existingSymbols = row.symbols;

    const hasEntryQualityPre = !!existingEntryQuality;
    const entryQualityAlreadyCorrect = entryQualityMatches(existingEntryQuality);
    const symbolsAlreadyCorrect = symbolsMatch(existingSymbols);

    // Determine symbol for overlay (fall back to legacy symbol column)
    const overlaySymbol = (row.symbol ?? "MES") as "MES" | "MNQ" | "MCL";
    const source = (row.source ?? "graduated_bucket") as
      | "ollama"
      | "openclaw"
      | "manual"
      | "graduated_bucket";

    // Re-invoke framework overlay (idempotent)
    const overlayResult = applyFrameworkOverlay({
      compiled: config as any,
      source,
      symbol: overlaySymbol,
    });

    // Merge entry_quality into the overlaid config
    const newConfig = {
      ...(overlayResult.config as Record<string, unknown>),
      entry_quality: LEGACY_ENTRY_QUALITY,
    };

    // Compute whether the resulting symbols need correction
    const newSymbols = symbolsAlreadyCorrect ? existingSymbols : EXPECTED_SYMBOLS;

    // Idempotency short-circuit: nothing changed → skip UPDATE
    const configUnchanged =
      entryQualityAlreadyCorrect &&
      JSON.stringify(overlayResult.config) === JSON.stringify(config);
    const symbolsUnchanged = symbolsAlreadyCorrect;

    if (configUnchanged && symbolsUnchanged) {
      console.log(`  OK   ${row.name}: already has correct entry_quality + symbols — no change needed`);
      alreadyCorrect++;
      continue;
    }

    // Print before/after diff
    console.log(`  UPD  ${row.name}:`);
    console.log(`         entry_quality pre:  ${hasEntryQualityPre ? JSON.stringify(existingEntryQuality) : "MISSING"}`);
    console.log(`         entry_quality post: ${JSON.stringify(LEGACY_ENTRY_QUALITY)}`);
    console.log(`         symbols pre:        ${JSON.stringify(existingSymbols)}`);
    console.log(`         symbols post:       ${JSON.stringify(newSymbols)}`);
    console.log(
      `         overlay rules applied: [${overlayResult.appliedRules.join(", ")}]`,
    );
    if (overlayResult.warnings.length) {
      overlayResult.warnings.forEach((w) => console.log(`         [warn] ${w}`));
    }

    if (!isDryRun) {
      await db.transaction(async (tx) => {
        // UPDATE the strategy row
        await tx
          .update(strategies)
          .set({
            config: newConfig,
            symbols: newSymbols,
          })
          .where(eq(strategies.id, row.id));

        // Audit row: action="strategy.legacy_overlay_applied"
        await tx.insert(auditLog).values({
          action: "strategy.legacy_overlay_applied",
          entityType: "strategy",
          entityId: row.id,
          decisionAuthority: "system",
          input: {
            strategy_id: row.id,
            name: row.name,
            has_entry_quality_pre: hasEntryQualityPre,
            symbols_pre: existingSymbols,
          } as Record<string, unknown>,
          result: {
            has_entry_quality_post: true,
            extraction_provenance: "legacy_no_confluence",
            symbols: newSymbols,
            overlay_rules_applied: overlayResult.appliedRules,
            wave: "23F",
            track: "F",
          } as Record<string, unknown>,
          status: "success",
        });
      });
    }

    updated++;
  }

  // Missing strategy check
  const foundNames = activeRows.map((r: any) => r.name);
  const missingNames = LEGACY_STRATEGY_NAMES.filter((n) => !foundNames.includes(n));
  if (missingNames.length > 0) {
    console.log();
    console.log(`  WARN: These strategies were NOT found (archived or deleted?): ${missingNames.join(", ")}`);
  }

  console.log();
  console.log("── Summary ──────────────────────────────────────");
  console.log(`  Updated:         ${updated}`);
  console.log(`  Already correct: ${alreadyCorrect}`);
  console.log(`  Missing/skipped: ${missingNames.length}`);
  if (isDryRun) {
    console.log("\n  [DRY RUN] — no DB changes made. Remove --dry-run to apply.");
  } else {
    console.log(`\n  ${updated} strategy row(s) updated.`);
  }
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
