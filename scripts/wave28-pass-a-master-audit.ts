/**
 * wave28-pass-a-master-audit.ts — Wave 28 Pass A MASTER CLOSE audit row.
 *
 * Inserts one `audit_log` row via direct SQL (NOT Drizzle ORM):
 *   action="wave.28_pass_a_master_closed"
 *
 * Run: npx tsx scripts/wave28-pass-a-master-audit.ts
 *
 * If DB write fails, persists payload to:
 *   docs/wave-28-pass-a-master-audit-row.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import postgres from "postgres";

function loadDbUrl(): string | null {
  try {
    const envContent = readFileSync(".env", "utf-8");
    const line = envContent.split("\n").find((l) => l.startsWith("DATABASE_URL="));
    const url = line?.split("=").slice(1).join("=").trim();
    if (url) return url;
  } catch {}
  return process.env.DATABASE_URL ?? null;
}

const result = {
  rounds_executed: 3,
  commits: [
    "b1b65f4",   // Round 1 — migration 0149 + aggregator + score-normalization
    "c3c3030",   // Round 2 — digest cron + composite-health routes + dashboard tile
    "ARCHITECT_CLOSE",
  ],
  tests_added_cumulative: 156,
  test_breakdown: {
    round_1_pytest: 24,
    round_1_aggregator_vitest: 30,
    round_1_score_normalization_vitest: 88,
    round_2_digest_cron_vitest: 7,
    round_2_routes_vitest: 7,
  },
  migrations_added: ["0149_strategy_health_scores.sql"],
  migration_idx_assigned: 151,
  new_subsystems: 5,
  new_subsystem_list: [
    "strategy_health_aggregator",
    "composite_health_digest_service",
    "composite_health_routes",
    "composite_health_tile",
    "score_normalization_lib",
  ],
  new_scheduled_jobs: 1,
  new_scheduled_job_list: ["composite-health-daily-digest"],
  new_audit_action_namespaces: 7,
  new_audit_actions: [
    "composite_health.evaluated",
    "composite_health.skipped_below_subsystem_threshold",
    "composite_health.aggregator_uncaught_error",
    "composite_health.daily_digest_emitted",
    "composite_health.digest_skipped_lock_contention",
    "composite_health.digest_skipped_dst_guard",
    "composite_health.digest_discord_failed",
  ],
  new_env_vars: [
    "MIN_COMPOSITE_SUBSYSTEMS",
    "COMPOSITE_MAX_AGE_HOURS",
    "WAVE_28_COMPOSITE_GATING_ENABLED",
  ],
  a2_todos_reconciled: {
    typed_drizzle_insert: true,
    real_compute_composite_from_lib: true,
    weights_version_id_16char_contract_preserved: true,
    aggregator_test_count_preserved: 30,
  },
  observability_only_invariant: true,
  composite_gates_promotion: false,
  wave_27_5_hard_gates_retain_veto: true,
  three_layer_architecture: {
    layer_a_hard_gates_unchanged: true,
    layer_c_decision_bus_new: true,
    layer_b_dashboard_new: true,
  },
  ci_hard_gates_status: {
    "system-map:check": "exit_0",
    "check:production-isolation": "exit_0",
    "check:2026-compliance": "exit_0",
  },
  metadata: {
    decision_authority: "parent-claude",
    entity_label: "wave-28-pass-a",
    pass_b_evidence_gate: "≥14 days composite write data + ≥85% composite-vs-hard-gate agreement",
    next_session_carry_forward: [
      "pass_b_composite_shadow_gate_helper",
      "pass_b_shadow_evaluation_audit_and_discord_p2",
      "pass_b_analyze_shadow_evidence_script",
      "pass_b_architect_close",
    ],
  },
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-28-pass-a-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.28_pass_a_master_closed",
        entity_type: "wave",
        entity_id: null,
        decision_authority: "parent-claude",
        status: "success",
        result,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function main() {
  const url = loadDbUrl();
  if (!url) {
    console.error("[w28-pa-audit] DATABASE_URL not found; persisting JSON fallback.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-28-pass-a-master-${Date.now()}`;

  try {
    const row = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.28_pass_a_master_closed',
        'wave',
        NULL,
        'parent-claude',
        ${result as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w28-pa-audit] wave.28_pass_a_master_closed written id=${row[0].id}`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w28-pa-audit] DB write FAILED: ${err.message}; persisting JSON fallback.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w28-pa-audit] fatal:", err);
  persistFallback();
  process.exit(2);
});
