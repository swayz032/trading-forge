require("dotenv/config");
const postgres = require("postgres");
const fs = require("node:fs");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    console.log("=== Persisted usage state (since restart 5 min ago) ===");
    const stateFile = "C:\\Users\\tonio\\Projects\\trading-forge\\trading-forge\\data\\openai-usage-state.json";
    if (fs.existsSync(stateFile)) {
      console.log(fs.readFileSync(stateFile, "utf-8"));
    } else {
      console.log("  state file not yet written (no calls made since restart)");
    }

    console.log("\n=== Proxy any actions in audit_log today (UTC) ===");
    const today = await sql`
      SELECT action, status, COUNT(*)::int AS n
      FROM audit_log
      WHERE created_at >= NOW()::date
      GROUP BY action, status
      ORDER BY n DESC
      LIMIT 30
    `;
    for (const r of today) console.log(`  ${r.action.padEnd(55)} ${r.status.padEnd(10)} ${r.n}`);

    console.log("\n=== TF activity proxies today (UTC) — these imply LLM calls ===");
    const buckets = await sql`SELECT COUNT(*)::int AS n FROM strategy_pending_buckets WHERE first_seen_at >= NOW()::date OR last_seen_at >= NOW()::date`;
    const mentions = await sql`SELECT COUNT(*)::int AS n FROM strategy_pending_mentions WHERE created_at >= NOW()::date`;
    const strats = await sql`SELECT COUNT(*)::int AS n FROM strategies WHERE created_at >= NOW()::date`;
    const journal = await sql`SELECT COUNT(*)::int AS n FROM system_journal WHERE created_at >= NOW()::date`;
    console.log(`  Pending buckets touched today:   ${buckets[0].n}`);
    console.log(`  New mentions today:              ${mentions[0].n}`);
    console.log(`  New strategies today:            ${strats[0].n}`);
    console.log(`  system_journal rows today:       ${journal[0].n}`);

    console.log("\n=== Token-count audit_log entries (any) ===");
    const tok = await sql`
      SELECT COUNT(*)::int AS n, COALESCE(SUM((result->>'total_tokens')::int), 0)::int AS sum_tokens
      FROM audit_log
      WHERE result ? 'total_tokens' AND created_at >= NOW()::date
    `;
    console.log(`  Rows with total_tokens field today: ${tok[0].n}  sum=${tok[0].sum_tokens?.toLocaleString?.() || tok[0].sum_tokens}`);

    console.log("\n=== Activity since restart (60min window) ===");
    const recent = await sql`
      SELECT action, COUNT(*)::int AS n
      FROM audit_log
      WHERE created_at >= NOW() - INTERVAL '60 minutes'
      GROUP BY action
      ORDER BY n DESC
      LIMIT 15
    `;
    for (const r of recent) console.log(`  ${r.action.padEnd(55)} ${r.n}`);
  } finally {
    await sql.end();
  }
})();
