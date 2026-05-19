import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!);
const cnt = await sql<{ n: number; fails: number }[]>`
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE status IN ('failed','error'))::int AS fails
  FROM n8n_execution_log
`;
const audit = await sql<{ n: number }[]>`
  SELECT COUNT(*)::int AS n FROM audit_log
  WHERE action='n8n.execution_log.scraped' AND created_at > NOW() - INTERVAL '15 minutes'
`;
console.log("n8n_execution_log rows:", cnt[0].n, "| failures:", cnt[0].fails);
console.log("audit_log scraper rows in last 15min:", audit[0].n);
await sql.end();
