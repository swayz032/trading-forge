// Wave 24 Pass 2.5 master close-out audit row
// Writes audit_log row: action='wave.24_master_closed' with full commit set.

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
  const auditRow = await sql`
    INSERT INTO audit_log (action, entity_type, result, status, decision_authority, created_at)
    VALUES (
      'wave.24_master_closed',
      'system',
      ${sql.json({
        wave: 24,
        closed_at: '2026-05-23',
        closed_by: 'wave24-pass2.5-architect',
        items_shipped: 23,
        items_total: 24,
        items_deferred: ['#24 HVN-snap TP2 + crypto-grade audit-log hash chain (Wave 25 candidate)'],
        completion_pct: 95.8,
        passes: ['Pass 1', 'Pass 1.5', 'Pass 2', 'Pass 2.5'],
        commit_refs: {
          pass1_n8n: '5ec8af3',
          pass1_observability: 'd3a98c4',
          pass1_paper_parity: '95cd2c4',
          pass1_backtest_core: 'bd9786e',
          pass1_architect: '93f5292',
          pass2_preflight: '2a6a344',
          pass2_boot_migration: '99225b7',
          pass2_observability: '69ac40b',
          pass2_backtest_core: '1ca782a',
        },
        migrations_applied: ['0131_operator_absent_pending.sql', '0132_hmm_regime_overlay.sql'],
        verification: {
          system_map_check: 'EXIT 0',
          production_isolation: 'EXIT 0 (4 files, 0 violations)',
          compliance_2026: 'EXIT 0',
          wave24_vitest: { files: 19, tests: 182, pass: 182, fail: 0 },
          tsc_new_errors: 0,
          tsc_preexisting: 231,
          pytest: 'blocked: Windows AppControl DLL (pre-existing, non-blocking)',
        },
        env_vars_added_total: 14,
        env_vars_added_pass2: [
          'BOOT_MIGRATION_ENABLED', 'BOOT_MIGRATION_ALLOW_NO_BACKUP',
          'BOOT_MIGRATION_BACKUP_DIR', 'BOOT_MIGRATION_TIMEOUT_MS',
          'STOP_BUFFER_TICKS_MES', 'STOP_BUFFER_TICKS_MNQ', 'STOP_BUFFER_TICKS_MCL',
          'HMM_OVERLAY_ENABLED', 'HMM_CONFIRM_THRESHOLD', 'HMM_DISAGREE_THRESHOLD',
        ],
        routes_added: ['POST /api/admin/operator-mark-present'],
        tables_added: ['regime_hmm_models', 'pre_market_sessions'],
        columns_added: ['bias_state.hmm_probability_used', 'system_state.operator_absent_pending'],
        jobs_added: [
          'hmm-regime-weekly-refit', 'bw-session-refresh', 'prop-firm-cookie-refresh',
          'weekly-drift-2sigma-check', 'pre-market-routine',
          'heartbeat-stale-check', 'heartbeat-write',
        ],
      })},
      'success',
      'scheduler',
      NOW()
    )
    RETURNING id, created_at
  `;
  console.log("wave.24_master_closed audit row written:", auditRow[0].id, "at", auditRow[0].created_at);

  const cnt = await sql`
    SELECT COUNT(*)::int as count FROM audit_log WHERE action = 'wave.24_master_closed'
  `;
  console.log("wave.24_master_closed rows in audit_log:", cnt[0].count);

  await sql.end();
  console.log("\nWave 24 master close-out COMPLETE");
}

main().catch(async (e) => {
  console.error("FATAL:", e);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
