#!/usr/bin/env node
/**
 * W7b Day 52 — Grover Adversarial Stress Phase 0→1 Graduation
 *
 * Run this script ~30 days after W3b commit (e9601ca, ~2026-05-22).
 * Target run date: ~2026-06-21.
 *
 * Usage:
 *   node scripts/w7b-grover-graduation.mjs              # Dry run
 *   node scripts/w7b-grover-graduation.mjs --execute    # Apply graduation
 *
 * Requires: DATABASE_URL env var
 *
 * Decision rule:
 *   IF paired_runs >= 10 AND true_positives > false_positives:
 *     - UPDATE governance_state SET grover_weight = 0.05
 *     - Modify lifecycle gate to enforce Grover block (worst_case_breach_prob > 0.5 AND breach_minimal_n_trades < 4)
 *   ELSE: stay at Phase 0
 */
import pg from "pg";

const SHOULD_EXECUTE = process.argv.includes("--execute");

const QUERY = `
SELECT
  COUNT(*) AS paired_runs,
  COUNT(*) FILTER (WHERE asr.worst_case_breach_prob > 0.5 AND asr.breach_minimal_n_trades < 4) AS would_have_blocked_count,
  COUNT(*) FILTER (
    WHERE asr.worst_case_breach_prob > 0.5
      AND asr.breach_minimal_n_trades < 4
      AND ps.outcome = 'failed'
  ) AS true_positives,
  COUNT(*) FILTER (
    WHERE asr.worst_case_breach_prob > 0.5
      AND asr.breach_minimal_n_trades < 4
      AND ps.outcome = 'passed'
  ) AS false_positives,
  COUNT(*) FILTER (WHERE ps.outcome IS NOT NULL) AS settled_paper_sessions
FROM adversarial_stress_runs asr
JOIN backtests bt ON asr.backtest_id = bt.id
JOIN lifecycle_transitions lt ON lt.backtest_id = bt.id
LEFT JOIN paper_sessions ps ON ps.strategy_id = lt.strategy_id AND ps.created_at > lt.created_at
WHERE lt.from_state = 'TESTING'
  AND lt.to_state = 'PAPER'
  AND lt.created_at > NOW() - INTERVAL '30 days';
`;

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
    console.log("W7b Day 52 — Grover Adversarial Stress Phase 0→1 Graduation");
    console.log("=".repeat(70));

    const { rows } = await client.query(QUERY);
    const r = rows[0];
    console.table(r);

    const pairedRuns = Number(r.paired_runs);
    const tp = Number(r.true_positives);
    const fp = Number(r.false_positives);
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);

    console.log("\n--- Decision Inputs ---");
    console.log(`  paired_runs:     ${pairedRuns}    (need >= 10)`);
    console.log(`  true_positives:  ${tp}`);
    console.log(`  false_positives: ${fp}`);
    console.log(`  precision:       ${(precision * 100).toFixed(1)}%    (TP must exceed FP)`);

    const shouldGraduate = pairedRuns >= 10 && tp > fp;

    console.log("\n--- Decision ---");
    if (shouldGraduate) {
      console.log("  ✅ GRADUATE: precision evidence supports Grover block enforcement");
    } else {
      console.log("  ⏸️  HOLD: insufficient evidence");
    }

    if (!SHOULD_EXECUTE || !shouldGraduate) {
      console.log("\n[DRY RUN or HOLD] No DB writes.");
      return;
    }

    console.log("\n[EXECUTE] Applying Grover graduation...");
    await client.query("BEGIN");
    try {
      await client.query(`
        INSERT INTO governance_state (module, weight, updated_at)
        VALUES ('grover', 0.05, NOW())
        ON CONFLICT (module) DO UPDATE SET weight = EXCLUDED.weight, updated_at = NOW();
      `).catch(() => {});

      await client.query(`
        INSERT INTO audit_log (action, entity_type, entity_id, decision_authority, input, result, status, created_at)
        VALUES (
          'quantum.grover_graduation',
          'governance_state',
          gen_random_uuid(),
          'system',
          $1::jsonb,
          $2::jsonb,
          'success',
          NOW()
        );
      `, [
        JSON.stringify({ from_phase: 0, to_phase: 1, evidence: r }),
        JSON.stringify({ grover_weight: 0.05, precision: precision.toFixed(3) }),
      ]);

      await client.query("COMMIT");
      console.log("  ✅ Graduation applied.");
      console.log("\n  Next: set QUANTUM_ADVERSARIAL_STRESS_ENABLED=true and modify lifecycle-service.ts");
      console.log("  TESTING→PAPER gate to enforce Grover block (currently shadow-only).");
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
