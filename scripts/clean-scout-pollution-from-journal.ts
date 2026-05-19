/**
 * Pass 21 (2026-05-12) — one-shot cleanup.
 *
 * system_journal was designed for the bot's actual trade-journal (read by the
 * 3am GPT-5 self-critique agent). The scout pipeline accidentally piggybacked
 * on it as a staging queue for years, polluting it with scout candidates.
 *
 * This script deletes scout-pipeline-only rows from system_journal. Criteria:
 *   - source IN ('graduated_bucket', 'openclaw')  -- legacy scout sources
 *   - status IN ('failed', 'scouted')             -- never reached a real trade
 *   - simulated_equity IS NULL                    -- never backtested
 *   - backtest_id IS NULL                         -- no actual run
 *
 * Rows that DID produce a real strategy (strategy_id NOT NULL AND
 * status='completed') are preserved as audit history for now, but going
 * forward the new direct-bucket-graduator skips system_journal entirely
 * for graduated_bucket strategies.
 *
 * Idempotent — re-running is safe.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const before = await sql<{ status: string; source: string; n: number }[]>`
    SELECT status, source, COUNT(*)::int AS n
    FROM system_journal
    GROUP BY status, source
    ORDER BY n DESC
  `;
  console.log("BEFORE — system_journal contents:");
  for (const r of before) console.log(`  ${r.status} / ${r.source} = ${r.n}`);

  const deleted = await sql<{ id: string; status: string; source: string }[]>`
    DELETE FROM system_journal
    WHERE source IN ('graduated_bucket', 'openclaw')
      AND status IN ('failed', 'scouted')
      AND simulated_equity IS NULL
      AND backtest_id IS NULL
    RETURNING id::text, status, source
  `;
  console.log(`\nDeleted ${deleted.length} polluted scout-pipeline rows`);

  const after = await sql<{ status: string; source: string; n: number }[]>`
    SELECT status, source, COUNT(*)::int AS n
    FROM system_journal
    GROUP BY status, source
    ORDER BY n DESC
  `;
  console.log("\nAFTER — system_journal contents (should be trade-journal only):");
  for (const r of after) console.log(`  ${r.status} / ${r.source} = ${r.n}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
