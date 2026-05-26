/**
 * wave29-master-audit.ts — Wave 29 WAVE-LEVEL MASTER CLOSE audit row.
 *
 * Inserts one `audit_log` row via direct SQL:
 *   action="wave.29_master_closed"
 *
 * Mirrors Wave 28 Pass D wave.28_master_closed precedent — this is the WAVE-LEVEL
 * close (not _pass_d_master_closed), consolidating Pass C + A + B + D into one row.
 *
 * Run: npx tsx scripts/wave29-master-audit.ts
 *
 * Fallback file: docs/wave-29-master-audit-row.json
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
  passes_shipped: ["C", "A", "B", "D"],
  commits: [
    "63529a9_wave29_pass_c_architect_master_close",
    "125fd83_wave29_pass_a_architect_master_close",
    "833c760_wave29_pass_b_architect_master_close",
    "150b329_wave29_pass_d_round1",
    "WAVE_29_MASTER_ARCHITECT_CLOSE_THIS_COMMIT",
  ],
  cumulative_new_tests: 432,
  tests_by_pass: {
    pass_c_rl_bridge: 190,
    pass_a_shadow_pbo: 111,
    pass_b_frozen_policy_regime: 53,
    pass_d_round1_observability_ab_digest: 78,
  },
  new_subsystems_registered_total: 7,
  new_subsystem_list: [
    "quantum_rl_challenger",
    "shadow_stage",
    "pbo_overfit_gate",
    "frozen_policy_contract",
    "regime_drift_detector",
    "ab_comparison",
    "wave29_observability_surface",
  ],
  new_migrations: [
    "0152_quantum_rl_runs.sql",
    "0159_broker_accounts_ab_paper_routing.sql",
    "0160_shadow_signals.sql",
    "0161_frozen_policy_contract.sql",
  ],
  new_scheduler_crons: [
    "quantum-rl-training-window",
    "regime-drift-detector",
    "ab-comparison-weekly-digest",
  ],
  new_routes: [
    "POST /api/admin/frozen-policy-override",
    "GET /api/ab-comparison/recent",
  ],
  new_audit_action_namespaces_total: 30,
  new_prometheus_counters: [
    "tf_pbo_blocks_total",
    "tf_shadow_signals_total",
    "tf_rl_training_epochs_total",
    "tf_rl_kill_switch_total",
    "tf_rl_ab_sharpe_delta",
    "tf_rl_ab_pnl_delta",
    "tf_frozen_policy_overrides_total",
    "tf_regime_drift_detections_total",
    "tf_lifecycle_shadow_promotions_total",
  ],
  new_sse_events: [
    "signal:shadow_logged",
    "signal:rl_ab_routed",
    "lifecycle:pbo_evaluated",
    "lifecycle:shadow_divergence_evaluated",
    "quantum_rl:training_completed",
    "quantum_rl:kill_switch_engaged",
  ],
  new_env_vars: [
    "QUANTUM_RL_REWARD_ALPHA",
    "QUANTUM_RL_REWARD_BETA",
    "QUANTUM_RL_IBM_CLOUD_OPT_IN",
    "QUANTUM_RL_TRAINING_EPOCHS",
    "QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT",
    "QUANTUM_RL_DSR_FLOOR",
    "PBO_OVERFIT_THRESHOLD_PCT",
    "SHADOW_DIVERGENCE_THRESHOLD_PCT",
    "SHADOW_DIVERGENCE_MIN_SAMPLE",
    "ADMIN_OVERRIDE_HMAC_SECRET",
  ],
  ci_hard_gates_status: {
    "system-map:check": "exit_0",
    "check:production-isolation": "exit_0",
    "check:2026-compliance": "exit_0",
  },
  challenger_governance_preserved: {
    rl_signal_never_gates_promotion: true,
    wave_27_5_hard_gates_retain_veto: true,
    wave_28_shadow_gate_retain_veto: true,
    shadow_divergence_and_pbo_are_additive_hard_gates: true,
    ab_comparison_surface_advisory_only: true,
    wave29_observability_surface_advisory_only: true,
  },
  invariants_preserved: {
    shadow_traderspost_webhook_called_false_at_table_level: true,
    rl_long_flat_two_action_only: true,
    quantum_rl_runs_namespace_separate_from_quantum_mc_runs: true,
    frozen_policy_hash_slice_5_fields_only: true,
    regime_drift_two_step_demotion_deployed_to_declining_to_testing: true,
    rl_composite_subsystem_two_gate_kill_switch_dormant_and_dsr_passed: true,
  },
  baseline_preserved: {
    wave_28_cumulative_tests: 205,
    wave_27_5_cumulative_tests: 530,
    zero_regressions: true,
  },
  metadata: {
    decision_authority: "parent-claude",
    entity_label: "wave-29",
    operator_next_actions: [
      "Set ADMIN_OVERRIDE_HMAC_SECRET (>=32 chars random) in production .env before any frozen-policy HMAC override attempt",
      "npm run db:migrate to apply 0152 + 0159 + 0160 + 0161 OR wait for boot-migration-runner on next deploy",
      "First RL-influenced paper trade expected ~3 days after first off-RTH training cycle completes (training auto-fires when entry_quality.train_rl_policy=true)",
      "A/B paper sub-accounts (slumdawg-baseline + slumdawg-rl-challenger) routed automatically once strategies graduate to PAPER via existing lifecycle ladder",
    ],
    wave_30_carry_forward_candidates: [
      "AWS Braket bridge completion (Braket sampler stub at quantum_mc.py:453-459 stays a stub through Wave 29)",
      "Wave 29 Phase 2 hard-gate wiring on RL signal if A/B evidence shows positive marginal edge over 30-60 days",
      "Wave 27 unified replay-grading harness --tool=all wiring into Wave 27 Pass 1.5 weekly cron",
    ],
  },
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-29-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.29_master_closed",
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
    console.error("[w29-master-audit] DATABASE_URL not found; persisting JSON fallback.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-29-master-${Date.now()}`;

  try {
    const row = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.29_master_closed',
        'wave',
        NULL,
        'parent-claude',
        ${result as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w29-master-audit] wave.29_master_closed written id=${row[0].id}`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w29-master-audit] DB write FAILED: ${err.message}; persisting JSON fallback.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w29-master-audit] unexpected error:", err);
  persistFallback();
  process.exit(2);
});
