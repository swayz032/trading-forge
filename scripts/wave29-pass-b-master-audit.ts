/**
 * wave29-pass-b-master-audit.ts — Wave 29 Pass B MASTER CLOSE audit row.
 *
 * Inserts one `audit_log` row via direct SQL:
 *   action="wave.29_pass_b_master_closed"
 *
 * Run: npx tsx scripts/wave29-pass-b-master-audit.ts
 *
 * Fallback file: docs/wave-29-pass-b-master-audit-row.json
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
  rounds_executed: 2,
  commits: ["B1_BACKTEST_CORE", "B2_B3_ROUND2_COMBINED", "ARCHITECT_CLOSE"],
  tests_added_cumulative: 53,
  test_breakdown: {
    b1_frozen_policy_migration_pytest: 15,
    b2_frozen_policy_contract_vitest: 22,
    b3_regime_drift_detector_vitest: 16,
  },
  wave_29_cumulative_tests_after_pass_b: 354,
  wave_29_pass_c_baseline_tests: 190,
  wave_29_pass_a_baseline_tests: 111,
  migrations_added: ["0161_frozen_policy_contract.sql"],
  new_subsystems: 2,
  new_subsystem_list: ["frozen_policy_contract", "regime_drift_detector"],
  pre_existing_drift_swept: ["needs_archetype_queue (attached to research_orchestration)"],
  new_scheduled_jobs: 1,
  new_scheduled_job_list: ["regime-drift-detector"],
  new_routes: ["/api/admin/frozen-policy-override"],
  new_audit_action_namespaces: 12,
  new_audit_actions: [
    "frozen_policy.set",
    "frozen_policy.override_used",
    "frozen_policy.override_rationale_too_short",
    "frozen_policy.hash_compute_failed",
    "lifecycle.frozen_policy_drift_blocked",
    "regime_drift_detector.skipped_lock_contention",
    "regime_drift_detector.skipped_dst_guard",
    "regime_drift_detector.legacy_strategy_skipped",
    "regime_drift_detector.dry_run",
    "regime_drift_detector.completed",
    "strategy.regime_drift_detected",
    "lifecycle.regime_drift_demotion",
  ],
  new_env_vars: ["ADMIN_OVERRIDE_HMAC_SECRET"],
  hard_gates_added: {
    frozen_policy_hash_drift_paper_to_deploy_ready: true,
    regime_drift_auto_demotion_5_consecutive_days: true,
  },
  frozen_policy_contract: {
    hash_algorithm: "sha256_canonical_sorted_json_full_64_char_digest",
    hash_slice_fields: [
      "entry_quality",
      "position_size",
      "stop_loss",
      "take_profit",
      "exit_plan_config",
    ],
    override_path: "POST /api/admin/frozen-policy-override",
    override_requirements: {
      hmac_signed: true,
      timestamp_drift_seconds: 60,
      rationale_min_chars: 50,
      increments_override_count: true,
    },
    runs_after_all_wave_27_5_hard_gates: true,
  },
  regime_drift_detector: {
    cron_name: "regime-drift-detector",
    cron_schedule_utc: "0 21,22 UTC",
    target_et_hour: 18,
    dst_safe_double_fire: true,
    pipeline_gate_exempt: true,
    job_lock_overlap_guard: true,
    drift_threshold_consecutive_days: 5,
    demotion_path: "DEPLOYED -> DECLINING -> TESTING (two-step)",
    legacy_skip_field: "strategies.regime_trained_on IS NULL",
  },
  ci_hard_gates_status: {
    "system-map:check": "exit_0",
    "check:production-isolation": "exit_0",
    "check:2026-compliance": "exit_0",
  },
  challenger_governance: {
    wave_27_5_hard_gates_retain_veto: true,
    wave_28_shadow_gate_retain_veto: true,
    wave_29_pass_c_rl_challenger_retain_veto: true,
    wave_29_pass_a_shadow_pbo_divergence_retain_veto: true,
    frozen_policy_drift_runs_after_all_above: true,
  },
  metadata: {
    decision_authority: "parent-claude",
    entity_label: "wave-29-pass-b",
    next_session_carry_forward: [
      "Wave 29 Pass D (A/B Sharpe dashboard tile + weekly Friday Discord A/B digest + Wave 29 MASTER close) per plan cryptic-watching-wombat.md",
      "Operator action: set ADMIN_OVERRIDE_HMAC_SECRET (>=32 chars random) in production .env before any HMAC override attempt",
      "Migration 0161 idempotent (ADD COLUMN IF NOT EXISTS x 4) applied by boot-migration-runner on next Railway deploy",
      "regime-drift-detector cron starts firing on next API restart (zero operator action)",
    ],
  },
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-29-pass-b-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.29_pass_b_master_closed",
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
    console.error("[w29-pb-audit] DATABASE_URL not found; persisting JSON fallback.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-29-pass-b-master-${Date.now()}`;

  try {
    const row = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.29_pass_b_master_closed',
        'wave',
        NULL,
        'parent-claude',
        ${result as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w29-pb-audit] wave.29_pass_b_master_closed written id=${row[0].id}`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w29-pb-audit] DB write FAILED: ${err.message}; persisting JSON fallback.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w29-pb-audit] fatal:", err);
  persistFallback();
  process.exit(2);
});
