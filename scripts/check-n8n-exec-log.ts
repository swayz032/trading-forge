import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL!);
const cnt = await sql<{n:number}[]>`SELECT COUNT(*)::int AS n FROM n8n_execution_log`;
const recent = await sql`SELECT execution_id, workflow_name, status, started_at, created_at FROM n8n_execution_log ORDER BY created_at DESC LIMIT 5`;
console.log("total rows:", cnt[0].n);
console.log("most recent 5:", JSON.stringify(recent, null, 2));
await sql.end();
