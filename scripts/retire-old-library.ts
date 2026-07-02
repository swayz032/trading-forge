/**
 * retire-old-library.ts (2026-07-02) — retire the OLD thin-extraction library after the compiler re-extraction.
 *
 * Operator directive: "make sure we deleted the old library once we do the full re-extraction." The 6-video
 * audit proved the old extractions have WRONG/INVERTED mechanisms on 5 of 6 videos (crossover-for-retest,
 * breakout-for-never-breakout, order_block-for-volume-profile, BOS-for-SFP...) — backtesting them never tested
 * the educators' strategies.
 *
 * Implementation: CANDIDATE → GRAVEYARD via the audited API path (PATCH /api/strategies/:id/lifecycle) —
 * GRAVEYARD is the terminal state with zero outbound transitions, so retired rows can never re-enter the
 * conveyor. This is the system's own "delete": atomic, audited (audit_log + lifecycle_transitions), FK-safe.
 * Targets ONLY the IDs frozen in docs/designs/old-library-snapshot-2026-07-02.json (117 rows snapshotted
 * BEFORE any re-extracted strategies exist) — new rows are structurally untouchable by this script.
 *
 * Usage:
 *   npx tsx scripts/retire-old-library.ts            # dry run — prints the plan, mutates nothing
 *   npx tsx scripts/retire-old-library.ts --apply    # executes (run ONLY after re-extraction + operator go)
 */
import { readFileSync } from "fs";

const API = process.env.TF_API_BASE ?? "http://localhost:4000";
const APPLY = process.argv.includes("--apply");
const REASON = "old-extractor thin library retired post-re-extraction (6-video audit 2026-07-02: mechanisms wrong/inverted on 5 of 6; entry_sequence null across all)";

async function main(): Promise<number> {
  const snap = JSON.parse(readFileSync("docs/designs/old-library-snapshot-2026-07-02.json", "utf-8"));
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: ${snap.count} strategies from snapshot ${snap.snapshot_at}`);
  let ok = 0, skipped = 0, failed = 0;
  for (const s of snap.strategies) {
    if (s.state === "GRAVEYARD") { skipped++; continue; }
    if (!APPLY) { console.log(`  would retire: ${s.name} (${s.state} -> GRAVEYARD)`); ok++; continue; }
    try {
      const r = await fetch(`${API}/api/strategies/${s.id}/lifecycle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "GRAVEYARD", reason: REASON, actor: "operator_directed_retirement" }),
      });
      if (r.ok) { ok++; console.log(`  retired: ${s.name}`); }
      else { failed++; console.log(`  FAILED ${s.name}: ${r.status} ${(await r.text()).slice(0, 120)}`); }
    } catch (e) { failed++; console.log(`  ERROR ${s.name}: ${String(e).slice(0, 120)}`); }
  }
  console.log(`\n${APPLY ? "retired" : "planned"}=${ok} already_graveyard=${skipped} failed=${failed}`);
  return failed > 0 ? 1 : 0;
}

main().then((c) => process.exit(c));
