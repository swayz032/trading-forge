require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    console.log("=== llm.gpt5mini_call rows today: drill by role / model context ===");
    // Sample a few to see what shape the input/result columns have
    const sample = await sql`
      SELECT input, result, entity_type, entity_id, created_at
      FROM audit_log
      WHERE action = 'llm.gpt5mini_call' AND created_at >= NOW()::date
      ORDER BY created_at DESC
      LIMIT 3
    `;
    for (const r of sample) {
      console.log(`\n  ${r.created_at.toISOString()}  entity=${r.entity_type}/${r.entity_id}`);
      console.log(`  input keys: ${Object.keys(r.input || {}).join(', ')}`);
      console.log(`  result keys: ${Object.keys(r.result || {}).join(', ')}`);
      console.log(`  input.role: ${r.input?.role}`);
      console.log(`  input.model: ${r.input?.model}`);
      console.log(`  result.usage: ${JSON.stringify(r.result?.usage)}`);
    }

    console.log("\n=== Calls grouped by input->role (top callers) ===");
    const byRole = await sql`
      SELECT input->>'role' AS role, COUNT(*)::int AS n
      FROM audit_log
      WHERE action = 'llm.gpt5mini_call' AND created_at >= NOW()::date
      GROUP BY role
      ORDER BY n DESC
      LIMIT 20
    `;
    for (const r of byRole) console.log(`  ${(r.role || '<none>').padEnd(40)} ${r.n}`);

    console.log("\n=== Hourly distribution today ===");
    const hourly = await sql`
      SELECT date_trunc('hour', created_at) AS hr, COUNT(*)::int AS n
      FROM audit_log
      WHERE action = 'llm.gpt5mini_call' AND created_at >= NOW()::date
      GROUP BY hr
      ORDER BY hr
    `;
    for (const r of hourly) console.log(`  ${r.hr.toISOString().slice(0,13)}  ${r.n}`);

    console.log("\n=== Calls vs entity_type breakdown ===");
    const byEntity = await sql`
      SELECT entity_type, COUNT(*)::int AS n
      FROM audit_log
      WHERE action = 'llm.gpt5mini_call' AND created_at >= NOW()::date
      GROUP BY entity_type
      ORDER BY n DESC
    `;
    for (const r of byEntity) console.log(`  ${(r.entity_type || '<null>').padEnd(40)} ${r.n}`);
  } finally {
    await sql.end();
  }
})();
