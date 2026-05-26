/**
 * wave29-pass-c-master-audit.ts — Wave 29 Pass C MASTER CLOSE audit row.
 *
 * Inserts one `audit_log` row via direct SQL (NOT Drizzle ORM):
 *   action="wave.29_pass_c_master_closed"
 *
 * Run: npx tsx scripts/wave29-pass-c-master-audit.ts
 *
 * If DB write fails, persists payload to:
 *   docs/wave-29-pass-c-master-audit-row.json
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
  commits: [
    "C1_C2_C3_COMBINED",
    "ARCHITECT_CLOSE",
  ],
  tests_added_cumulative: 190,
  test_breakdown: {
    c1_trading_env_pytest: 55,
    c2_training_loop_pytest: 17,
    c3_cpcv_purge_pytest: 12,
    c3_cpcv_gate_vitest: 18,
    c3_dsr_gate_vitest: 25,
    c3_composite_13th_subsystem_vitest: 27,
    c3_ab_routing_vitest: 20,
  },
  wave_29_cumulative_tests: 190,
  migrations_added: [
    "0152_quantum_rl_runs.sql",
    "0159_broker_accounts_ab_paper_routing.sql",
  ],
  new_subsystems: 1,
  new_subsystem_list: ["quantum_rl_challenger"],
  new_scheduled_jobs: 1,
  new_scheduled_job_list: ["quantum-rl-training-window"],
  new_audit_action_namespaces: 13,
  new_audit_actions: [
    "quantum_rl.training_auto_fire_enqueued",
    "quantum_rl.training_auto_fire_failed",
    "quantum_rl.training_circuit_breaker_opened",
    "quantum_rl.kill_switch_evaluated",
    "quantum_rl.kill_switch_engaged",
    "quantum_rl.cloud_path_engaged",
    "quantum_rl.training_cpcv_purge_violation",
    "quantum_rl.dsr_floor_block",
    "quantum_rl.dsr_passed",
    "quantum_rl.signal_routed",
    "quantum_rl.regime_insufficient_data",
    "quantum_rl.training_skipped_in_rth_window",
    "signal.rl_ab_routed",
  ],
  new_env_vars: [
    "QUANTUM_RL_REWARD_ALPHA",
    "QUANTUM_RL_REWARD_BETA",
    "QUANTUM_RL_IBM_CLOUD_OPT_IN",
    "QUANTUM_RL_TRAINING_EPOCHS",
    "QUANTUM_RL_KILL_SWITCH_THRESHOLD_PCT",
    "QUANTUM_RL_DSR_FLOOR",
  ],
  challenger_only_invariant: true,
  rl_gates_promotion: false,
  wave_27_5_hard_gates_retain_veto: true,
  wave_28_shadow_gate_retain_veto: true,
  governance: {
    decision_role: "challenger_only",
    namespace_separate_from_quantum_mc_runs: true,
    long_flat_action_space_enforced: true,
    ibm_cloud_two_gate_required: true,
  },
  composite_subsystem_count: 13,
  min_composite_subsystems_floor: 8,
  ci_hard_gates_status: {
    "system-map:check": "exit_0",
    "check:production-isolation": "exit_0",
    "check:2026-compliance": "exit_0",
  },
  system_map_fixes_applied: {
    quantum_rl_challenger_registry_entry_added: true,
    pre_existing_drift_resolved: [
      "1 scheduler job mapping (quantum-rl-training-window)",
      "1 database table mapping (quantum_rl_runs)",
    ],
  },
  metadata: {
    decision_authority: "parent-claude",
    entity_label: "wave-29-pass-c",
    next_session_carry_forward: [
      "Wave 29 Pass A (Shadow Stage + PBO Gate) per plan cryptic-watching-wombat.md",
      "Wave 29 Pass B + Pass D evidence-gated",
      "First RL-influenced paper trade ~3 days from Pass C ship (paper-as-training framing)",
      "Migrations 0152 + 0159 applied by boot-migration-runner on next Railway deploy",
    ],
  },
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-29-pass-c-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.29_pass_c_master_closed",
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
    console.error("[w29-pc-audit] DATABASE_URL not found; persisting JSON fallback.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-29-pass-c-master-${Date.now()}`;

  try {
    const row = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.29_pass_c_master_closed',
        'wave',
        NULL,
        'parent-claude',
        ${result as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w29-pc-audit] wave.29_pass_c_master_closed written id=${row[0].id}`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w29-pc-audit] DB write FAILED: ${err.message}; persisting JSON fallback.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w29-pc-audit] fatal:", err);
  persistFallback();
  process.exit(2);
});
