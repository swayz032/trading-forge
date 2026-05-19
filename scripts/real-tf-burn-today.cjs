require("dotenv/config");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

(async () => {
  try {
    console.log("=== AUTHORITATIVE: TF gpt-5-mini tokens today (sum from audit_log) ===");
    const total = await sql`
      SELECT
        COUNT(*)::int AS calls,
        COALESCE(SUM((result->>'inputTokens')::int), 0)::bigint AS input_tokens,
        COALESCE(SUM((result->>'outputTokens')::int), 0)::bigint AS output_tokens,
        COALESCE(SUM((result->>'reasoningTokens')::int), 0)::bigint AS reasoning_tokens
      FROM audit_log
      WHERE action = 'llm.gpt5mini_call' AND created_at >= NOW()::date
    `;
    const r = total[0];
    console.log(`  Calls:            ${r.calls.toLocaleString()}`);
    console.log(`  Input tokens:     ${Number(r.input_tokens).toLocaleString()}`);
    console.log(`  Output tokens:    ${Number(r.output_tokens).toLocaleString()}`);
    console.log(`  Reasoning tokens: ${Number(r.reasoning_tokens).toLocaleString()}`);
    console.log(`  Total tokens:     ${(Number(r.input_tokens) + Number(r.output_tokens) + Number(r.reasoning_tokens)).toLocaleString()}`);
    console.log(`  Avg input/call:   ${Math.round(Number(r.input_tokens) / r.calls).toLocaleString()}`);

    console.log("\n=== vs OpenAI dashboard May 12: input=51,341,137  cached=46,941,952 ===");
    const tfInput = Number(r.input_tokens);
    const dashInput = 51_341_137;
    console.log(`  TF reported input: ${tfInput.toLocaleString()}`);
    console.log(`  Dashboard input:   ${dashInput.toLocaleString()}`);
    console.log(`  TF share of dashboard:  ${((tfInput / dashInput) * 100).toFixed(1)}%`);

    console.log("\n=== By apiPath (route used) ===");
    const byPath = await sql`
      SELECT result->>'apiPath' AS path, COUNT(*)::int AS n,
             COALESCE(SUM((result->>'inputTokens')::int), 0)::bigint AS in_tok,
             COALESCE(SUM((result->>'outputTokens')::int), 0)::bigint AS out_tok
      FROM audit_log
      WHERE action = 'llm.gpt5mini_call' AND created_at >= NOW()::date
      GROUP BY path
      ORDER BY n DESC
    `;
    for (const x of byPath) console.log(`  ${(x.path || '<none>').padEnd(40)} calls=${x.n}  in=${Number(x.in_tok).toLocaleString()}  out=${Number(x.out_tok).toLocaleString()}`);

    console.log("\n=== Hourly burn (input tokens) ===");
    const hourly = await sql`
      SELECT date_trunc('hour', created_at) AS hr,
             COUNT(*)::int AS calls,
             COALESCE(SUM((result->>'inputTokens')::int), 0)::bigint AS in_tok
      FROM audit_log
      WHERE action = 'llm.gpt5mini_call' AND created_at >= NOW()::date
      GROUP BY hr
      ORDER BY hr
    `;
    for (const x of hourly) console.log(`  ${x.hr.toISOString().slice(0,13)}  calls=${String(x.calls).padStart(4)}  input_tok=${Number(x.in_tok).toLocaleString().padStart(12)}`);

    console.log("\n=== Concurrent activity right before each big-burst hour (correlation hunt) ===");
    const bigHours = await sql`
      SELECT date_trunc('hour', created_at) AS hr, action, COUNT(*)::int AS n
      FROM audit_log
      WHERE created_at >= NOW()::date
      AND date_trunc('hour', created_at) IN (
        '2026-05-12 07:00:00+00'::timestamptz,
        '2026-05-12 10:00:00+00'::timestamptz,
        '2026-05-12 14:00:00+00'::timestamptz
      )
      GROUP BY hr, action
      HAVING COUNT(*) > 5
      ORDER BY hr, n DESC
    `;
    let lastHr = null;
    for (const x of bigHours) {
      if (x.hr.toISOString() !== lastHr) { console.log(`\n  ${x.hr.toISOString().slice(0,13)}`); lastHr = x.hr.toISOString(); }
      console.log(`    ${x.action.padEnd(45)} ${x.n}`);
    }
  } finally {
    await sql.end();
  }
})();
