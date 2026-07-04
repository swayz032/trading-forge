/**
 * Direction-both restoration backfill (companion to the 2026-07-04 direction fix,
 * commit 7498230). The pre-fix `framework-overlay.ts` coercion guard silently
 * turned certified `direction:"both"` spec-onboarded strategies into long-only
 * (set `direction="long"`, `entry_short=""`) because its exemption list never
 * learned the newer `spec_conditions:` / `archetype_dispatch:` dispatch markers.
 * The code fix stops NEW rows from being coerced; THIS restores the already-coerced
 * rows in place (no delete/re-onboard, IDs preserved, reversible via audit).
 *
 * SAFETY CONTRACT (three independent conditions must ALL hold to restore a row):
 *   1. Spec-authoritative — the row's certified artifact `spec.direction === "both"`
 *      (resolved via config.metadata.spec_hash). The DB row is never the authority.
 *   2. Handler-driven — reuses the SINGLE source of truth `isHandlerDrivenEntry()`
 *      (the same helper both guards use). Only strategies whose engine handler
 *      genuinely emits BOTH long and short (spec_conditions:/archetype_dispatch:)
 *      are restored. Parked NEEDS_ARCHETYPE rows (no engine handler) are LEFT ALONE
 *      on purpose — restoring "both" on a strategy that cannot run both sides would
 *      be the exact cosmetic lie the fix exists to prevent.
 *   3. Currently-coerced — only rows in the (direction="long", entry_short="")
 *      coerced state are candidates. A genuine long spec has entry_short="high < low"
 *      (BIDIR_SENTINEL), never "" — so this can never touch an honest long strategy.
 *
 * Restore = set config.direction="both" and config.strategy.entry_short =
 * config.strategy.entry_long (the same handler-driven marker on both sides — exactly
 * what the fixed onboarding now produces). Idempotent (re-runs skip already-"both"
 * rows). Dry-run by default; --apply writes + audits `strategy.direction_both_restored`.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/backfill-corpus-direction-both.ts           # dry run
 *   node --env-file=.env --import tsx scripts/backfill-corpus-direction-both.ts --apply   # writes
 */
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { db } from "../src/server/db/index.js";
import { strategies } from "../src/server/db/schema.js";
import { eq } from "drizzle-orm";
import { isHandlerDrivenEntry } from "../src/server/lib/handler-driven-entry.js";
import { insertAuditRowSafe } from "../src/server/lib/audit-log-helper.js";

const DEFAULT_SPECS_DIR = ".claude/worktrees/extraction-100/corpus/specs";

async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const specsDir =
    (() => {
      const i = process.argv.indexOf("--specs-dir");
      return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
    })() ?? DEFAULT_SPECS_DIR;

  // spec_hash -> spec.direction (the authority)
  const specDir = new Map<string, string | null>();
  for (const f of readdirSync(specsDir).filter((x) => x.endsWith(".spec.json"))) {
    try {
      const d = JSON.parse(readFileSync(`${specsDir}/${f}`, "utf8"));
      if (typeof d?.spec_hash === "string") specDir.set(d.spec_hash, d?.spec?.direction ?? null);
    } catch {
      /* skip unreadable spec */
    }
  }

  // all spec_onboarding rows (coerced-candidate filtering happens in the loop)
  const rows = await db.select().from(strategies).where(eq(strategies.source, "spec_onboarding"));

  const toRestore: Array<{ id: string; name: string; el: string }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const row of rows) {
    const cfg = (row.config ?? {}) as Record<string, unknown>;
    const strat = (cfg.strategy ?? {}) as Record<string, unknown>;
    const dir = String(cfg.direction ?? "");
    const el = String(strat.entry_long ?? "");
    const es = String(strat.entry_short ?? "");
    // only currently-coerced rows are candidates
    if (dir !== "long" || es !== "") continue;

    const meta = (cfg.metadata ?? {}) as Record<string, unknown>;
    const sh = typeof meta.spec_hash === "string" ? meta.spec_hash : "";
    const specDirection = sh ? specDir.get(sh) ?? null : null;
    const ei = typeof cfg.entry_indicator === "string" ? cfg.entry_indicator : undefined;
    // ask the SINGLE source of truth: if we restore entry_short=entry_long, is this handler-driven?
    const handlerDriven = isHandlerDrivenEntry(el, el, ei);

    if (specDirection === "both" && handlerDriven) {
      toRestore.push({ id: row.id, name: row.name, el });
    } else {
      skipped.push({
        name: row.name,
        reason: specDirection !== "both" ? `spec.direction=${specDirection ?? "unknown"}` : "not handler-driven (parked/no engine handler)",
      });
    }
  }

  console.log(`${apply ? "APPLY" : "DRY RUN"}: direction-both restoration (spec_onboarding rows only)`);
  console.log(`specs dir: ${specsDir}\n`);
  console.log(`=== TO RESTORE (spec.direction=both AND handler-driven): ${toRestore.length} ===`);
  for (const r of toRestore) console.log(`  ${r.name}  <- entry_short = ${r.el}`);
  if (toRestore.length === 0) console.log("  (none)");
  console.log(`\n=== SKIPPED coerced-but-not-restorable: ${skipped.length} ===`);
  for (const r of skipped) console.log(`  ${r.name}  — ${r.reason}`);
  if (skipped.length === 0) console.log("  (none)");

  if (!apply) {
    console.log("\nDRY RUN complete — nothing written. Re-run with --apply after review.");
    return 0;
  }

  console.log("\nAPPLY: restoring direction=both + entry_short...");
  let restored = 0;
  for (const r of toRestore) {
    const row = rows.find((x) => x.id === r.id)!;
    const cfg = { ...(row.config as Record<string, unknown>) };
    cfg.direction = "both";
    cfg.strategy = { ...((cfg.strategy ?? {}) as Record<string, unknown>), entry_short: r.el };

    await db.update(strategies).set({ config: cfg, updatedAt: new Date() }).where(eq(strategies.id, r.id));
    await insertAuditRowSafe({
      action: "strategy.direction_both_restored",
      entityType: "strategy",
      entityId: r.id,
      status: "success",
      input: { old_direction: "long", old_entry_short: "" },
      result: { new_direction: "both", new_entry_short: r.el, reason: "pre-fix framework-overlay coercion undone (commit 7498230)" },
      decisionAuthority: "gate",
    });
    restored++;
  }
  console.log(`\nAPPLY complete. ${restored} rows restored to direction='both'; ${skipped.length} left unchanged (parked/not-both).`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
