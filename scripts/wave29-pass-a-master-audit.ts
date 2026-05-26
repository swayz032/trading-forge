/**
 * wave29-pass-a-master-audit.ts — Wave 29 Pass A MASTER CLOSE audit row.
 *
 * Inserts one `audit_log` row via direct SQL:
 *   action="wave.29_pass_a_master_closed"
 *
 * Run: npx tsx scripts/wave29-pass-a-master-audit.ts
 *
 * Fallback file: docs/wave-29-pass-a-master-audit-row.json
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
  rounds_executed: 1,
  commits: ["A1_A2_A3_ROUND1_COMBINED", "ARCHITECT_CLOSE"],
  tests_added_cumulative: 111,
  test_breakdown: {
    a1_paper_parity_vitest: 57,
    a2_pbo_gate_pytest: 12,
    a2_pbo_gate_vitest: 23,
    a3_shadow_divergence_vitest: 19,
  },
  wave_29_cumulative_tests_after_pass_a: 301,
  wave_29_pass_c_baseline_tests: 190,
  migrations_added: ["0160_shadow_signals.sql"],
  new_subsystems: 2,
  new_subsystem_list: ["shadow_stage", "pbo_overfit_gate"],
  new_scheduled_jobs: 0,
  new_audit_action_namespaces: 9,
  new_audit_actions: [
    "lifecycle.shadow_signal_logged",
    "lifecycle.shadow_mode_inconsistency_warn",
    "lifecycle.shadow_divergence_blocked",
    "lifecycle.shadow_divergence_insufficient_samples",
    "lifecycle.shadow_promotion_passed",
    "lifecycle.shadow_divergence_check_unavailable_legacy",
    "lifecycle.pbo_overfit_block",
    "lifecycle.pbo_unavailable_legacy",
    "walk_forward.pbo_computed",
    "walk_forward.pbo_high_overfit_risk",
  ],
  new_sse_events: [
    "signal:shadow_logged",
    "lifecycle:pbo_evaluated",
    "lifecycle:shadow_divergence_evaluated",
  ],
  new_env_vars: [
    "PBO_OVERFIT_THRESHOLD_PCT",
    "SHADOW_DIVERGENCE_THRESHOLD_PCT",
    "SHADOW_DIVERGENCE_MIN_SAMPLE",
  ],
  hard_gates_added: {
    pbo_lt_15pct_testing_to_shadow_or_paper: true,
    shadow_divergence_lt_5pct_shadow_to_paper: true,
  },
  shadow_invariants: {
    traderspost_webhook_called_false_at_table_level: true,
    testing_to_shadow_to_paper_canonical_ladder: true,
  },
  a3_todo_reconciled: {
    file: "src/server/services/lifecycle-service.ts",
    line: 1994,
    before: "const shadowStrategies: typeof strategies.$inferSelect[] = [];",
    after: 'await db.select().from(strategies).where(eq(strategies.lifecycleState, "SHADOW"))',
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
    pbo_and_divergence_are_additive_hard_gates: true,
  },
  metadata: {
    decision_authority: "parent-claude",
    entity_label: "wave-29-pass-a",
    next_session_carry_forward: [
      "Wave 29 Pass B (Frozen-Policy + Regime Retrain) per plan cryptic-watching-wombat.md",
      "Wave 29 Pass D evidence-gated",
      "Migration 0160 applied by boot-migration-runner on next Railway deploy",
    ],
  },
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-29-pass-a-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.29_pass_a_master_closed",
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
    console.error("[w29-pa-audit] DATABASE_URL not found; persisting JSON fallback.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-29-pass-a-master-${Date.now()}`;

  try {
    const row = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.29_pass_a_master_closed',
        'wave',
        NULL,
        'parent-claude',
        ${result as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w29-pa-audit] wave.29_pass_a_master_closed written id=${row[0].id}`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w29-pa-audit] DB write FAILED: ${err.message}; persisting JSON fallback.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w29-pa-audit] fatal:", err);
  persistFallback();
  process.exit(2);
});
