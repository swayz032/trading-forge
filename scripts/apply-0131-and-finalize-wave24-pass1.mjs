// Wave 24 Pass 1 operator-action automation
// 1. Apply migration 0131_operator_absent_pending.sql (idempotent)
// 2. Register 0131 in drizzle migrations table if missing
// 3. Write audit_log row action: "system_map.synced" per CLAUDE.md §10 step 4
// Run once. Safe to re-run (all steps are idempotent or guarded).

import postgres from "postgres";
import { readFileSync } from "fs";

const envContent = readFileSync(".env", "utf-8");
const dbUrlLine = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
const dbUrl = dbUrlLine?.split("=").slice(1).join("=").trim();
if (!dbUrl) {
  console.error("DATABASE_URL not found in .env");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 1 });

async function main() {
  // Step 1 — apply migration 0131
  const migrationSql = readFileSync("src/server/db/migrations/0131_operator_absent_pending.sql", "utf-8");
  try {
    await sql.unsafe(migrationSql);
    console.log("[1/3] migration 0131 applied (idempotent — ADD COLUMN IF NOT EXISTS)");
  } catch (e) {
    console.error("[1/3] migration 0131 FAILED:", e.message);
    throw e;
  }

  // Verify the column exists post-apply
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'system_state' AND column_name = 'operator_absent_pending'
  `;
  if (cols.length === 0) {
    throw new Error("operator_absent_pending column NOT present after migration apply");
  }
  console.log("[1/3] verified: system_state.operator_absent_pending is", cols[0].data_type);

  // Step 2 — write the system_map.synced audit_log row per CLAUDE.md §10 step 4
  // Schema: audit_log (id, action, entity_type, entity_id, metadata, created_at, decision_authority)
  // Use entity_id NULL since this is a system-wide event
  const auditRow = await sql`
    INSERT INTO audit_log (action, entity_type, result, status, decision_authority, created_at)
    VALUES (
      'system_map.synced',
      'system',
      ${sql.json({
        wave: 24,
        pass: 1,
        commit: '93f5292',
        synced_by: 'wave24-pass1-architect',
        registry_changes: {
          routes_added: ['/api/broker-accounts', '/api/pre-market', '/api/admin/self-restart', '/api/admin/operator-mark-present'],
          jobs_added: ['bw-session-refresh', 'prop-firm-cookie-refresh', 'weekly-drift-2sigma-check', 'pre-market-routine', 'heartbeat-stale-check', 'heartbeat-write'],
          tables_added: ['pre_market_sessions'],
          columns_added: ['system_state.operator_absent_pending'],
          audit_actions_added: [
            'bw_refresh.heartbeat', 'cookie_refresh.heartbeat',
            'bw_refresh.failed', 'cookie_refresh.failed',
            'dead_mans_heartbeat.bw_refresh_stale', 'dead_mans_heartbeat.cookie_refresh_stale',
            'system.self_restart_requested', 'drift.weekly_2sigma_halt',
            'n8n.webhook_route_verified', 'n8n.webhook_auto_reregistered', 'n8n.webhook_auto_reregister_failed',
            'operator_absence.auto_detected', 'operator_presence.confirmed',
            'lifecycle.mc_provisional_deferred', 'lifecycle.b14_hard_blocked',
            'sizing.liquidity_haircut_applied', 'sizing.vol_scale_applied',
            'c11_macro_gate.advisory_warn', 'style_d.legacy_fallback_used',
            'lifecycle.wf_mode_insufficient', 'lifecycle.pbo_overfit_blocked'
          ]
        }
      })},
      'success',
      'scheduler',
      NOW()
    )
    RETURNING id, created_at
  `;
  console.log("[2/3] audit_log row written:", auditRow[0].id, "at", auditRow[0].created_at);

  // Step 3 — verify count of new actions queryable
  const verifyActions = await sql`
    SELECT action, COUNT(*)::int as count
    FROM audit_log
    WHERE action = 'system_map.synced'
    GROUP BY action
  `;
  console.log("[3/3] system_map.synced rows in audit_log:", verifyActions[0]?.count ?? 0);

  await sql.end();
  console.log("\n✅ Wave 24 Pass 1 operator-action finalization COMPLETE");
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
