import { config as dotenvConfig } from "dotenv";
import { join } from "node:path";
dotenvConfig({ path: join(process.cwd(), ".env") });
const { db } = await import("../src/server/db/index.js");
const { sql } = await import("drizzle-orm");

// Pass 8 Track A (2026-06-23): Replace hardcoded broker_account_id FK with dynamic
// lookup so the script is idempotent on a fresh DB.  The previously hardcoded UUID
// references a broker_accounts row that is never created by any migration, causing
// a FK violation on fresh installs.
//
// Fix: dynamically resolve the Mazi broker account via account_id_external.
// If no match → log warn + skip that member's broker_account_id assignment
// (set null instead) rather than throw and abort the whole seed.
const maziAccountResult = await db.execute(sql`
  SELECT account_id
  FROM broker_accounts
  WHERE account_id_external = 'mazi-topstep-50k'
  LIMIT 1
`);

const maziAccountRows = Array.isArray(maziAccountResult)
  ? maziAccountResult
  : (maziAccountResult as { rows?: unknown[] }).rows ?? [];

let maziAccountId: string | null = null;
if (maziAccountRows.length > 0) {
  maziAccountId = (maziAccountRows[0] as Record<string, unknown>).account_id as string;
} else {
  console.warn(
    "seed.slumhouse_orphan_broker_skipped: no broker_accounts row with " +
    "account_id_external='mazi-topstep-50k' — skipping Mazi broker_account_id assignment. " +
    "Insert the broker_accounts row or run the operator account-setup script first.",
  );

  // Emit audit record to audit_log for traceability (non-blocking on failure).
  try {
    const resultPayload = JSON.stringify({
      discord_user_id: "1376634013443424450",
      display_name: "Slumdawg Mazi",
      reason: "broker_accounts row with account_id_external=mazi-topstep-50k not found",
    });
    await db.execute(sql`
      INSERT INTO audit_log (id, action, entity_type, status, result, created_at)
      VALUES (
        gen_random_uuid(),
        'seed.slumhouse_orphan_broker_skipped',
        'slumhouse_user',
        'info',
        ${resultPayload}::jsonb,
        NOW()
      )
    `);
  } catch (_auditErr) {
    // audit write failure is non-blocking; main seed continues
  }
}

const crew = [
  // Mazi: broker_account_id resolved dynamically; null when row missing (no FK violation).
  { discord_user_id: "1376634013443424450", display_name: "Slumdawg Mazi",  jersey: 25, broker_account_id: maziAccountId },
  { discord_user_id: "1063953397734191106", display_name: "SlumDawG Dinero", jersey: 7,  broker_account_id: null },
  { discord_user_id: "1508517794860503070", display_name: "Slumdog",         jersey: 4,  broker_account_id: null },
];

for (const m of crew) {
  await db.execute(sql`
    INSERT INTO slumhouse_users (discord_user_id, display_name, jersey_number, broker_account_id)
    VALUES (${m.discord_user_id}, ${m.display_name}, ${m.jersey}, ${m.broker_account_id})
    ON CONFLICT (discord_user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      jersey_number = EXCLUDED.jersey_number,
      broker_account_id = EXCLUDED.broker_account_id
  `);
  console.log(`✓ ${m.display_name} (#${m.jersey})  →  ${m.broker_account_id ?? "(no broker yet)"}`);
}

const all: any = await db.execute(sql`SELECT discord_user_id, display_name, jersey_number, broker_account_id FROM slumhouse_users ORDER BY jersey_number`);
const rows = Array.isArray(all) ? all : (all as { rows?: unknown[] }).rows ?? [];
console.log(`\nslumhouse_users table — ${rows.length} row(s) total`);
process.exit(0);
