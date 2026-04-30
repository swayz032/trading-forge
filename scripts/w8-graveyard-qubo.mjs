#!/usr/bin/env node
/**
 * W8 — Tier 2 Quantum Graveyard QUBO Trigger
 *
 * Run AFTER W7a Phase 0→1 graduation lands (~2026-05-31).
 * Gated on W7a commit existence.
 *
 * Usage:
 *   node scripts/w8-graveyard-qubo.mjs              # Verify W7a precondition + dry run
 *   node scripts/w8-graveyard-qubo.mjs --execute    # Set QUANTUM_GRAVEYARD_QUBO_ENABLED=true
 *
 * Requires: DATABASE_URL env var
 *
 * This script ONLY verifies the precondition + flips the flag.
 * The actual code changes (extending build_parameter_qubo with graveyard_centroids)
 * must be implemented first via the quantum-challenger subagent before flipping the flag.
 */
import pg from "pg";

const SHOULD_EXECUTE = process.argv.includes("--execute");

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
    console.log("W8 — Tier 2 Quantum Graveyard QUBO");
    console.log("=".repeat(70));

    // Precondition check: W7a Phase 0→1 graduation audit log entry must exist
    const { rows: w7aCheck } = await client.query(`
      SELECT COUNT(*) AS count, MAX(created_at) AS latest
      FROM audit_log
      WHERE action = 'quantum.qae_graduation'
        AND status = 'success';
    `);

    const w7aGraduated = Number(w7aCheck[0].count) > 0;
    console.log(`\n--- W7a Precondition ---`);
    console.log(`  W7a QAE graduation: ${w7aGraduated ? `✅ Yes (latest: ${w7aCheck[0].latest})` : "❌ No"}`);

    if (!w7aGraduated) {
      console.log("\n  ⏸️  Cannot proceed — run scripts/w7a-qae-graduation.mjs --execute first");
      console.log("  W8 was reordered AFTER W7a Phase 0→1 to avoid polluting agreement metric.");
      process.exit(0);
    }

    // Code change check: build_parameter_qubo extension must be in code
    console.log(`\n--- Code Readiness Check ---`);
    console.log("  Verify quantum_annealing_optimizer.py:build_parameter_qubo()");
    console.log("  has graveyard_centroids parameter implemented before flipping flag.");
    console.log("  Search: grep -n 'graveyard_centroids' src/engine/quantum_annealing_optimizer.py");

    if (!SHOULD_EXECUTE) {
      console.log("\n[DRY RUN] No DB writes. Re-run with --execute after code is ready.");
      return;
    }

    console.log("\n[EXECUTE] Logging W8 enablement...");
    await client.query(`
      INSERT INTO audit_log (action, entity_type, entity_id, decision_authority, input, result, status, created_at)
      VALUES (
        'quantum.graveyard_qubo_enabled',
        'governance_state',
        gen_random_uuid(),
        'system',
        $1::jsonb,
        $2::jsonb,
        'success',
        NOW()
      );
    `, [
      JSON.stringify({ tier: 2, gated_on: "w7a_qae_graduation" }),
      JSON.stringify({ flag: "QUANTUM_GRAVEYARD_QUBO_ENABLED", value: true }),
    ]);

    console.log("  ✅ Logged. Now manually:");
    console.log("    export QUANTUM_GRAVEYARD_QUBO_ENABLED=true");
    console.log("    pm2 restart trading-forge-server");
  } finally {
    await client.end();
  }
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
