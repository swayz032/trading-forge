/**
 * wave27-5-pass-d-master-audit.ts — Wave 27.5 Pass D + MASTER CLOSE audit rows.
 *
 * Inserts two `audit_log` rows via direct SQL (NOT Drizzle ORM):
 *   1. action="wave.27_5_pass_d_master_closed"   — Pass D close-out summary
 *   2. action="wave.27_5_master_closed"          — Wave 27.5 institutional-grade certification
 *
 * Run: npx tsx scripts/wave27-5-pass-d-master-audit.ts
 *
 * If DB write fails, persists payloads to:
 *   docs/wave-27-5-pass-d-master-audit-row.json
 *   docs/wave-27-5-master-audit-row.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
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

const passDResult = {
  med_findings_closed: 8,
  carry_forwards_closed: 4,
  sub_tracks: 4,
  commits: ["cec10f5", "3246730", "783ab91", "1692ad3", "ARCHITECT_CLOSE"],
  tests_added: 186,
  env_vars_added: 14,
  new_python_modules: 4,
  new_ts_helpers: 1,
  migrations_added: 0,
  institutional_defaults_flipped: [
    "zero_volume_fail_loud",
    "roll_spread_itemized",
    "margin_vix_expansion",
  ],
  wave_27_5_complete: true,
};

const masterResult = {
  passes_shipped: 4,
  sub_tracks_total: 16,
  commits_total: 14,
  tests_added_total: 530,
  findings_closed_total: 19,
  criticals_closed: 3,
  highs_closed: 8,
  meds_closed: 8,
  lows_closed: 1,
  migrations_added: 3,
  env_vars_added: 14,
  new_subsystems: 11,
  audit_actions_added: 30,
  institutional_grade_certified: true,
  b14_hard_gate_unblocked: true,
  paper_backtest_parity_closed: true,
  carry_forwards: [
    "wave_27_pass_2_evidence_gated",
    "wave_27_pass_3_evidence_gated",
    "wave_27_pass_4_blocked_python_verification",
    "phase_5_true_mini_contract_specs",
  ],
};

function persistFallback() {
  mkdirSync("docs", { recursive: true });
  writeFileSync(
    "docs/wave-27-5-pass-d-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.27_5_pass_d_master_closed",
        entity_type: "wave",
        entity_id: null,
        decision_authority: "system",
        status: "success",
        result: passDResult,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    "docs/wave-27-5-master-audit-row.json",
    JSON.stringify(
      {
        action: "wave.27_5_master_closed",
        entity_type: "wave",
        entity_id: null,
        decision_authority: "system",
        status: "success",
        result: masterResult,
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
    console.error("[w27-5-audit] DATABASE_URL not found; persisting JSON fallbacks.");
    persistFallback();
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  const corr = `wave-27-5-master-${Date.now()}`;

  try {
    const rowPassD = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.27_5_pass_d_master_closed',
        'wave',
        NULL,
        'system',
        ${passDResult as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w27-5-audit] wave.27_5_pass_d_master_closed written id=${rowPassD[0].id}`);

    const rowMaster = await sql`
      INSERT INTO audit_log (
        action, entity_type, entity_id, decision_authority,
        result, status, correlation_id
      ) VALUES (
        'wave.27_5_master_closed',
        'wave',
        NULL,
        'system',
        ${masterResult as any}::jsonb,
        'success',
        ${corr}
      )
      RETURNING id
    `;
    console.log(`[w27-5-audit] wave.27_5_master_closed written id=${rowMaster[0].id}`);

    await sql.end({ timeout: 5 });
    process.exit(0);
  } catch (err: any) {
    console.error(`[w27-5-audit] DB write FAILED: ${err.message}; persisting JSON fallbacks.`);
    persistFallback();
    try {
      await sql.end({ timeout: 5 });
    } catch {}
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[w27-5-audit] fatal:", err);
  persistFallback();
  process.exit(2);
});
