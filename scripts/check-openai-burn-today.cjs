require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    // 1. Audit log: every OpenAI proxy call records here
    console.log("=== Searching audit_log for openai_proxy calls today (UTC) ===");
    const calls = await sql`
      SELECT
        COUNT(*)::int AS call_count,
        COALESCE(SUM((result->>'total_tokens')::int), 0)::int AS total_tokens,
        COALESCE(SUM((result->>'prompt_tokens')::int), 0)::int AS prompt_tokens,
        COALESCE(SUM((result->>'cached_tokens')::int), 0)::int AS cached_tokens,
        COALESCE(SUM((result->>'completion_tokens')::int), 0)::int AS completion_tokens,
        COALESCE(SUM((result->>'reasoning_tokens')::int), 0)::int AS reasoning_tokens
      FROM audit_log
      WHERE action LIKE 'openai_proxy%' OR action LIKE 'openai.%'
      AND created_at >= NOW()::date
    `;
    console.log(JSON.stringify(calls[0], null, 2));

    // 2. By action / role
    console.log("\n=== Top callers today (by action) ===");
    const byAction = await sql`
      SELECT
        action,
        COUNT(*)::int AS calls,
        COALESCE(SUM((result->>'total_tokens')::int), 0)::int AS tokens
      FROM audit_log
      WHERE (action LIKE 'openai%' OR action LIKE 'agent%')
      AND created_at >= NOW()::date
      GROUP BY action
      ORDER BY tokens DESC NULLS LAST
      LIMIT 15
    `;
    for (const r of byAction) console.log(`  ${(r.action || '').padEnd(50)}  calls=${r.calls}  tokens=${(r.tokens || 0).toLocaleString()}`);

    // 3. Check if openai-proxy actually writes its own audit rows
    console.log("\n=== Sample of MOST RECENT openai-related audit rows ===");
    const recent = await sql`
      SELECT action, status, created_at, input->>'model' AS model,
             (result->>'total_tokens')::int AS tot,
             (result->>'cached_tokens')::int AS cached
      FROM audit_log
      WHERE action LIKE 'openai%'
      ORDER BY created_at DESC
      LIMIT 5
    `;
    for (const r of recent) console.log(`  ${r.created_at.toISOString()}  ${r.action}  status=${r.status}  model=${r.model}  tot=${r.tot}  cached=${r.cached}`);

    // 4. Check what model-router roles fired today via agent.* actions
    console.log("\n=== Agent calls today by entity / count ===");
    const agentCounts = await sql`
      SELECT action, status, COUNT(*)::int AS n
      FROM audit_log
      WHERE action LIKE 'agent%' AND created_at >= NOW()::date
      GROUP BY action, status
      ORDER BY n DESC
      LIMIT 20
    `;
    for (const r of agentCounts) console.log(`  ${r.action.padEnd(50)} ${r.status.padEnd(10)} ${r.n}`);
  } finally {
    await sql.end();
  }
})();
