/**
 * Pass 21 v3 (2026-05-17) — archive THIN strategies whose entry_long is a
 * Layer-1 placeholder rather than a real strategy rule.
 *
 * These are leftovers from the old pipeline that graduated on web-snippet
 * coverage alone. The new gates (Pass 21 DSL Quality Critic) would reject
 * them. Archiving cleans the library without losing the 2 THIN that have
 * real rules.
 *
 * Mode:  --apply  (default = dry run)
 */
require("dotenv/config");
const postgres = require("postgres");
const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const PLACEHOLDER_PATTERNS = [
  /Web-layer discovery candidate from Brave/i,
  /Web-layer cross-validation:/i,
  /Reddit relevance match for/i,
  /Pending YouTube \+ Red/i,
  /content surfaced on a reputable web source/i,
];

function isPlaceholder(entryLong) {
  if (!entryLong || typeof entryLong !== "string") return false;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(entryLong));
}

(async () => {
  try {
    console.log(`MODE: ${APPLY ? "APPLY" : "DRY RUN"}\n`);
    const rows = await sql`
      SELECT id, name,
             config->'entry_params' as entry_params,
             config->'strategy'->'entry_long' as entry_long
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
        AND NOT ('archived_duplicate' = ANY(COALESCE(tags, ARRAY[]::text[])))
      ORDER BY name`;

    const archive = [];
    const keep = [];
    for (const r of rows) {
      const paramCount = r.entry_params ? Object.keys(r.entry_params).length : 0;
      if (paramCount > 0) { keep.push({ ...r, reason: "SOLID (has params)" }); continue; }
      if (isPlaceholder(r.entry_long)) archive.push(r);
      else keep.push({ ...r, reason: "THIN-but-has-real-rule" });
    }

    console.log("══════════════════════════════════════════════════════");
    console.log(`ARCHIVE: ${archive.length} placeholder-only THIN strategies`);
    console.log("══════════════════════════════════════════════════════");
    for (const a of archive) console.log(`  ✗ ${a.name}`);

    console.log("\n══════════════════════════════════════════════════════");
    console.log(`KEEP: ${keep.length} strategies`);
    console.log("══════════════════════════════════════════════════════");
    for (const k of keep) console.log(`  ✓ ${k.name}  — ${k.reason}`);

    if (APPLY && archive.length > 0) {
      console.log("\nApplying archive...");
      for (const a of archive) {
        await sql`
          UPDATE strategies
          SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || ARRAY['archived_duplicate','archived_thin_placeholder']))
          WHERE id = ${a.id}`;
        await sql`
          INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority)
          VALUES ('strategy.archived_thin_placeholder','strategy',${a.id},
                  ${sql.json({ strategy_name: a.name, reason: 'entry_long is Layer-1 placeholder, not real rule' })},
                  ${sql.json({ archived_at: new Date().toISOString() })},
                  'success','system')`;
      }
      console.log(`✓ Archived ${archive.length}.`);
    } else if (!APPLY) {
      console.log("\n(dry run — re-run with --apply)");
    }
  } finally {
    await sql.end();
  }
})();
