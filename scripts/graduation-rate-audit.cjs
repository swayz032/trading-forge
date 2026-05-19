require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    console.log("=== Graduation rate, hourly (last 48h UTC) ===");
    const hourly = await sql`
      SELECT date_trunc('hour', created_at) AS hr, COUNT(*)::int AS n
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
      AND created_at >= NOW() - INTERVAL '48 hours'
      GROUP BY hr
      ORDER BY hr DESC
      LIMIT 50
    `;
    for (const r of hourly) console.log(`  ${r.hr.toISOString().slice(0,13)}Z  ${String(r.n).padStart(3)}`);

    console.log("\n=== Daily totals (last 7 days) ===");
    const daily = await sql`
      SELECT date_trunc('day', created_at) AS day, COUNT(*)::int AS n
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
      AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY day
      ORDER BY day DESC
    `;
    for (const r of daily) console.log(`  ${r.day.toISOString().slice(0,10)}  ${String(r.n).padStart(4)}`);

    console.log("\n=== pending_bucket.graduated audit_log events (hourly, last 24h) ===");
    const audits = await sql`
      SELECT date_trunc('hour', created_at) AS hr, COUNT(*)::int AS n
      FROM audit_log
      WHERE action = 'pending_bucket.graduated' AND created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY hr
      ORDER BY hr DESC
    `;
    for (const r of audits) console.log(`  ${r.hr.toISOString().slice(0,13)}Z  ${String(r.n).padStart(3)}`);

    console.log("\n=== Where the graduations are coming from — concept names of last 20 ===");
    const recent = await sql`
      SELECT name, created_at
      FROM strategies
      WHERE config->'metadata'->>'source' = 'graduated_bucket'
      ORDER BY created_at DESC
      LIMIT 20
    `;
    for (const r of recent) console.log(`  ${r.created_at.toISOString()}  ${r.name}`);

    console.log("\n=== Daily caps / rate-limit config check ===");
    // Find any rows that look like rate-limit config in audit_log or system_config
    const checkCron = await sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'pending_bucket.graduated' AND created_at >= NOW()::date`;
    const checkAttempts = await sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action LIKE 'pending_bucket%' AND created_at >= NOW()::date`;
    const grad24 = await sql`SELECT COUNT(*)::int AS n FROM strategies WHERE config->'metadata'->>'source' = 'graduated_bucket' AND created_at >= NOW() - INTERVAL '24 hours'`;
    console.log(`  Graduations today (UTC):           ${checkCron[0].n}`);
    console.log(`  Total pending_bucket events today: ${checkAttempts[0].n}`);
    console.log(`  Graduations in last 24h rolling:   ${grad24[0].n}`);
  } finally {
    await sql.end();
  }
})();
