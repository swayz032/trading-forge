#!/usr/bin/env node
/**
 * W7a Day 30 — QAE Phase 0→1 Graduation
 *
 * Run this script ~30 days after W2 commit (37598ad, 2026-04-30).
 * Target run date: ~2026-05-30.
 *
 * Usage:
 *   node scripts/w7a-qae-graduation.mjs              # Dry run (query only, no DB writes)
 *   node scripts/w7a-qae-graduation.mjs --execute    # Run + apply graduation if criteria met
 *
 * Requires: DATABASE_URL env var (PostgreSQL connection string)
 *
 * Decision rule (per plan):
 *   IF median_agreement > 0.70 AND paired_runs >= 20 AND fallback_rate < 0.20:
 *     - UPDATE governance_state SET qae_weight = 0.05
 *     - Set QUANTUM_QAE_GATE_PHASE=1 (advisory disagreement alerts)
 *     - Audit log entry quantum.qae_graduation
 *   ELSE: stay at Phase 0
 */
import pg from "pg";

const SHOULD_EXECUTE = process.argv.includes("--execute");

const QUERY = `
SELECT
  COUNT(*) FILTER (WHERE quantum_agreement_score IS NOT NULL) AS paired_runs,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY quantum_agreement_score) AS median_agreement,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY quantum_agreement_score) AS p25_agreement,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY quantum_agreement_score) AS p75_agreement,
  COUNT(*) FILTER (WHERE quantum_fallback_triggered) AS fallback_count,
  COUNT(*) FILTER (WHERE ABS(quantum_classical_disagreement_pct) > 5) AS large_disagreement_count,
  COUNT(*) AS total_transitions
FROM lifecycle_transitions
WHERE created_at > NOW() - INTERVAL '30 days';
`;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: DATABASE_URL not set. Export it first.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    console.log("=".repeat(70));
    console.log("W7a Day 30 — QAE Phase 0→1 Graduation Evaluation");
    console.log("=".repeat(70));

    const { rows } = await client.query(QUERY);
    const r = rows[0];
    console.log("\n--- Evidence (last 30 days) ---");
    console.table(r);

    const pairedRuns = Number(r.paired_runs);
    const medianAgreement = r.median_agreement === null ? 0 : Number(r.median_agreement);
    const fallbackCount = Number(r.fallback_count);
    const fallbackRate = pairedRuns === 0 ? 1 : fallbackCount / pairedRuns;

    console.log("\n--- Decision Inputs ---");
    console.log(`  paired_runs:     ${pairedRuns}    (need >= 20)`);
    console.log(`  median_agreement: ${medianAgreement.toFixed(3)}    (need > 0.70)`);
    console.log(`  fallback_rate:   ${(fallbackRate * 100).toFixed(1)}%    (need < 20%)`);

    const shouldGraduate = pairedRuns >= 20 && medianAgreement > 0.70 && fallbackRate < 0.20;

    console.log("\n--- Decision ---");
    if (shouldGraduate) {
      console.log("  ✅ GRADUATE: criteria met, advancing QAE Phase 0 → Phase 1");
    } else {
      console.log("  ⏸️  HOLD: criteria not met, staying at Phase 0");
      const reasons = [];
      if (pairedRuns < 20) reasons.push(`insufficient paired_runs (${pairedRuns} < 20)`);
      if (medianAgreement <= 0.70) reasons.push(`median_agreement ${medianAgreement.toFixed(3)} <= 0.70`);
      if (fallbackRate >= 0.20) reasons.push(`fallback_rate ${(fallbackRate * 100).toFixed(1)}% >= 20%`);
      console.log(`  Reasons: ${reasons.join(", ")}`);
    }

    if (!SHOULD_EXECUTE) {
      console.log("\n[DRY RUN] No DB writes. Re-run with --execute to apply graduation.");
      return;
    }

    if (!shouldGraduate) {
      console.log("\n[EXECUTE] Skipping DB writes (decision: HOLD).");
      return;
    }

    // Apply graduation
    console.log("\n[EXECUTE] Applying QAE graduation...");
    await client.query("BEGIN");
    try {
      // Upsert governance_state row
      await client.query(`
        INSERT INTO governance_state (module, weight, updated_at)
        VALUES ('qae', 0.05, NOW())
        ON CONFLICT (module) DO UPDATE SET weight = EXCLUDED.weight, updated_at = NOW();
      `).catch((err) => {
        if (err.code === "42P01") {
          console.warn("  governance_state table missing — create it first or use audit_log only.");
          return null;
        }
        throw err;
      });

      // Audit log entry
      await client.query(`
        INSERT INTO audit_log (action, entity_type, entity_id, decision_authority, input, result, status, created_at)
        VALUES (
          'quantum.qae_graduation',
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
        JSON.stringify({ qae_weight: 0.05, threshold_met: true }),
      ]);

      await client.query("COMMIT");
      console.log("  ✅ Graduation applied. Set QUANTUM_QAE_GATE_PHASE=1 in env and restart server.");
      console.log("\n  Next steps:");
      console.log("    export QUANTUM_QAE_GATE_PHASE=1");
      console.log("    pm2 restart trading-forge-server  # or your process manager");
      console.log("    Then run: node scripts/w8-graveyard-qubo.mjs (W8 gated on this commit)");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("  ❌ Graduation FAILED — rolled back:", err.message);
      process.exit(2);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
