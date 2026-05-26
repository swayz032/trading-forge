/**
 * wave27-carry-forward-master-audit.ts — Wave 27 Carry-Forward MASTER CLOSE audit row.
 *
 * Inserts one `audit_log` row via direct SQL (NOT Drizzle ORM):
 *   action="wave.27_carry_forward_master_closed"
 *
 * Run: npx tsx scripts/wave27-carry-forward-master-audit.ts
 *
 * If DB write fails, persists payload to:
 *   docs/wave-27-carry-forward-master-audit-row.json
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
  carry_forwards_executed: 4,
  replay_harnesses_shipped: 6,
  replay_harness_list: [
    "confluence",
    "critique",
    "robustness",
    "survival_twin",
    "pattern_aggregator",
    "consistency",
  ],
  unified_dispatcher_shipped: true,
  phase5_scaffold_shipped: true,
  phase5_enabled_default: false,
  commits: [
    "b194e8a",
    "3ce4251",
    "d7c3fb2",
    "88ee8a7",
    "8d77265",
    "6099def",
    "082a7d4",
    "ARCHITECT_CLOSE",
  ],
  tests_added: 250,
  audit_actions_added: 8,
  env_vars_added: 1,
  new_subsystems: 8,
  new_subsystem_list: [
    "replay_grade_confluence",
    "replay_grade_critique",
    "replay_grade_robustness",
    "replay_grade_survival_twin",
    "replay_grade_pattern_aggregator",
    "replay_grade_consistency",
    "replay_grade_unified_dispatcher",
    "phase5_contract_spec_scaffold",
  ],
  survival_scorer_write_free_verified: true,
  b14_unblocked: true,
  metadata: {
    decision_authority: "parent-claude",
    entity_label: "wave-27-carry-forward",
    supersedes_carry_forwards_from: "wave-27.5-master-close",
    next_session_carry_forward: [
      "wire_replay_grade_all_into_pass_1_5_weekly_cron",
      "evaluate_hard_gate_wiring_when_preliminary_transitions_signal",
      "phase_5_activation_when_funded_balance_ge_200k",
      "operator_db_migrate_0146_0147_0148",
    ],
  },
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-27-carry-forward-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.27_carry_forward_master_closed",
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
    console.error("[w27-cf-audit] DATABASE_URL not found; persisting JSON fallback.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-27-carry-forward-master-${Date.now()}`;

  try {
    const row = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.27_carry_forward_master_closed',
        'wave',
        NULL,
        'parent-claude',
        ${result as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w27-cf-audit] wave.27_carry_forward_master_closed written id=${row[0].id}`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w27-cf-audit] DB write FAILED: ${err.message}; persisting JSON fallback.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w27-cf-audit] fatal:", err);
  persistFallback();
  process.exit(2);
});
