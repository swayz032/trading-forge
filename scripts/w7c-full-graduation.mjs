#!/usr/bin/env node
/**
 * W7c Day 90 — Full Quantum Phase 1→2 Graduation + CLAUDE.md Authority Update
 *
 * Run this script ~90 days after W2 commit (37598ad, 2026-04-30).
 * Target run date: ~2026-07-29.
 *
 * Usage:
 *   node scripts/w7c-full-graduation.mjs              # Dry run + report
 *   node scripts/w7c-full-graduation.mjs --execute    # Apply graduations per module
 *
 * Requires: DATABASE_URL env var
 *
 * Decision rule per module (correlation > 0.30 with paper outcomes):
 *   - QAE     → governance_state.qae_weight = 0.10, QUANTUM_QAE_GATE_PHASE=2
 *   - Grover  → governance_state.grover_weight = 0.10
 *   - Ising   → governance_state.ising_weight = 0.10
 *
 * After execution: invoke claude-md-management:claude-md-improver to update CLAUDE.md
 * gate authority section if any module graduated to Phase 2.
 */
import pg from "pg";

const SHOULD_EXECUTE = process.argv.includes("--execute");

const QUERY = `
WITH quantum_predictions AS (
  SELECT
    lt.strategy_id,
    lt.quantum_agreement_score,
    lt.quantum_advantage_delta,
    lt.created_at AS promotion_date,
    asr.worst_case_breach_prob,
    cqr.ising_corrected_estimate,
    ps.outcome,
    ps.realized_pnl,
    ps.max_drawdown
  FROM lifecycle_transitions lt
  LEFT JOIN adversarial_stress_runs asr ON asr.backtest_id = lt.backtest_id
  LEFT JOIN cloud_qmc_runs cqr ON cqr.backtest_id = lt.backtest_id
  LEFT JOIN paper_sessions ps ON ps.strategy_id = lt.strategy_id AND ps.created_at > lt.created_at
  WHERE lt.from_state = 'TESTING' AND lt.to_state = 'PAPER'
    AND lt.created_at > NOW() - INTERVAL '90 days'
)
SELECT
  CORR(quantum_agreement_score, CASE WHEN outcome = 'passed' THEN 1 ELSE 0 END) AS qae_correlation,
  CORR(worst_case_breach_prob, CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS grover_correlation,
  CORR(ising_corrected_estimate, CASE WHEN outcome = 'passed' THEN 1 ELSE 0 END) AS ising_correlation,
  COUNT(*) AS total_promotions,
  COUNT(*) FILTER (WHERE outcome IS NOT NULL) AS settled_paper_sessions
FROM quantum_predictions;
`;

const THRESHOLD = 0.30;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    console.log("=".repeat(70));
    console.log("W7c Day 90 — Full Quantum Phase 1→2 Graduation");
    console.log("=".repeat(70));

    const { rows } = await client.query(QUERY);
    const r = rows[0];

    const correlations = {
      qae:    r.qae_correlation === null ? null : Number(r.qae_correlation),
      grover: r.grover_correlation === null ? null : Number(r.grover_correlation),
      ising:  r.ising_correlation === null ? null : Number(r.ising_correlation),
    };

    console.log("\n--- 90-day Empirical Correlations (vs paper outcomes) ---");
    console.table([{
      qae_correlation: correlations.qae?.toFixed(3) ?? "n/a",
      grover_correlation: correlations.grover?.toFixed(3) ?? "n/a",
      ising_correlation: correlations.ising?.toFixed(3) ?? "n/a",
      total_promotions: Number(r.total_promotions),
      settled_paper_sessions: Number(r.settled_paper_sessions),
    }]);

    const decisions = {
      qae:    correlations.qae !== null && correlations.qae > THRESHOLD,
      grover: correlations.grover !== null && correlations.grover > THRESHOLD,
      ising:  correlations.ising !== null && correlations.ising > THRESHOLD,
    };

    console.log("\n--- Decisions (threshold > 0.30) ---");
    for (const [mod, graduate] of Object.entries(decisions)) {
      console.log(`  ${mod.padEnd(8)} ${graduate ? "✅ Phase 1 → Phase 2" : "⏸️  HOLD"}`);
    }

    if (!SHOULD_EXECUTE) {
      console.log("\n[DRY RUN] No DB writes. Re-run with --execute to apply.");
      return;
    }

    const graduated = [];
    await client.query("BEGIN");
    try {
      for (const [mod, graduate] of Object.entries(decisions)) {
        if (!graduate) continue;
        await client.query(`
          INSERT INTO governance_state (module, weight, updated_at)
          VALUES ($1, 0.10, NOW())
          ON CONFLICT (module) DO UPDATE SET weight = EXCLUDED.weight, updated_at = NOW();
        `, [mod]).catch(() => {});

        await client.query(`
          INSERT INTO audit_log (action, entity_type, entity_id, decision_authority, input, result, status, created_at)
          VALUES (
            $1, 'governance_state', gen_random_uuid(), 'system',
            $2::jsonb, $3::jsonb, 'success', NOW()
          );
        `, [
          `quantum.${mod}_phase2_graduation`,
          JSON.stringify({ from_phase: 1, to_phase: 2, correlation: correlations[mod] }),
          JSON.stringify({ [`${mod}_weight`]: 0.10 }),
        ]);

        graduated.push(mod);
      }

      await client.query("COMMIT");

      if (graduated.length > 0) {
        console.log(`\n  ✅ Graduated to Phase 2: ${graduated.join(", ")}`);
        console.log("\n  Manual follow-up required:");
        console.log("    1. set QUANTUM_QAE_GATE_PHASE=2 if QAE graduated");
        console.log("    2. Open Claude Code session and invoke:");
        console.log("       /claude-md-management:claude-md-improver");
        console.log("    3. Update CLAUDE.md gate authority section to reflect new weights");
        console.log("    4. Notify user via Discord (POST /api/openclaw/daily-report)");
      } else {
        console.log("\n  ⏸️  No modules graduated. Continue Phase 1 measurement.");
      }
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("  ❌ Failed:", err.message);
      process.exit(2);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
