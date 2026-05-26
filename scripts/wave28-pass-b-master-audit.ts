/**
 * wave28-pass-b-master-audit.ts — Wave 28 Pass B MASTER CLOSE audit row.
 *
 * Inserts one `audit_log` row via direct SQL (NOT Drizzle ORM):
 *   action="wave.28_pass_b_master_closed"
 *
 * Run: npx tsx scripts/wave28-pass-b-master-audit.ts
 *
 * If DB write fails, persists payload to:
 *   docs/wave-28-pass-b-master-audit-row.json
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
    "b1c7b8a", // Round 1 — composite-shadow-gate helper + lifecycle wire-in (21 vitest)
    "6c332b6", // Round 2 — shadow Discord router + shadow-evidence-analyzer + script (28 vitest)
    "ARCHITECT_CLOSE",
  ],
  tests_added_cumulative: 49,
  test_breakdown: {
    round_1_shadow_gate_vitest: 21,
    round_2_shadow_router_vitest: 8,
    round_2_shadow_analyzer_vitest: 20,
  },
  wave_28_cumulative_tests: 205,
  wave_28_pass_a_tests: 156,
  wave_28_pass_b_tests: 49,
  migrations_added: [],
  new_subsystems: 1,
  new_subsystem_list: ["composite_shadow_gate"],
  new_scheduled_jobs: 0,
  new_scheduled_job_list: [],
  new_audit_action_namespaces: 7,
  new_audit_actions: [
    "composite.shadow_evaluation",
    "composite.shadow_evaluation_error",
    "composite.shadow_disagreement_alerted",
    "composite.shadow_disagreement_rate_limited",
    "composite.shadow_disagreement_discord_failed",
    "shadow_analysis.completed",
    "shadow_analysis.failed",
  ],
  new_env_vars: [],
  reused_env_vars: ["COMPOSITE_MAX_AGE_HOURS"],
  observability_only_invariant: true,
  composite_gates_promotion: false,
  wave_27_5_hard_gates_retain_veto: true,
  three_layer_architecture: {
    layer_a_hard_gates_unchanged: true,
    layer_c_decision_bus_extended: true,
    layer_b_dashboard_unchanged: true,
    pass_b_adds_shadow_gate_advisory_only: true,
  },
  shadow_mode: true,
  pass_c_evidence_gate: {
    required_days: 14,
    required_agreement_pct: 0.85,
    analyzer_helper: "src/server/lib/shadow-evidence-analyzer.ts",
    analyzer_script: "scripts/analyze-shadow-evidence.ts",
    verdicts: ["PRELIMINARY", "ACTIVATE_PASS_C", "INCONCLUSIVE", "REVISE_COMPOSITE"],
  },
  ci_hard_gates_status: {
    "system-map:check": "exit_0",
    "check:production-isolation": "exit_0",
    "check:2026-compliance": "exit_0",
  },
  system_map_fixes_applied: {
    composite_shadow_gate_registry_entry_added: true,
    pre_existing_drift_resolved: [
      "strategy-stale-detector scheduler job mapped under strategy_lifecycle",
      "statistics engine subsystem mapped under strategy_lifecycle",
      "late_cycle_overheating_regime telemetry_sources populated",
    ],
  },
  metadata: {
    decision_authority: "parent-claude",
    entity_label: "wave-28-pass-b",
    pass_c_evidence_gate: "≥14 days shadow data + ≥85% composite-vs-hard-gate agreement",
    next_session_carry_forward: [
      "accumulate 14 days of composite.shadow_evaluation rows",
      "run scripts/analyze-shadow-evidence.ts after 14 days",
      "pass_c_three_layer_live_dispatch (evidence-gated)",
    ],
  },
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-28-pass-b-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.28_pass_b_master_closed",
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
    console.error("[w28-pb-audit] DATABASE_URL not found; persisting JSON fallback.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-28-pass-b-master-${Date.now()}`;

  try {
    const row = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.28_pass_b_master_closed',
        'wave',
        NULL,
        'parent-claude',
        ${result as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w28-pb-audit] wave.28_pass_b_master_closed written id=${row[0].id}`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w28-pb-audit] DB write FAILED: ${err.message}; persisting JSON fallback.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w28-pb-audit] fatal:", err);
  persistFallback();
  process.exit(2);
});
