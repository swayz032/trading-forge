import postgres from 'postgres';
import 'dotenv/config';

const sql = postgres(process.env.DATABASE_URL);
const strategies = await sql`select id, name, lifecycle_state, created_at from strategies order by created_at desc limit 15`;
console.log('STRATEGIES:');
console.log(JSON.stringify(strategies, null, 2));
const journal = await sql`select id, kind, status, payload->>'source' as src, created_at from system_journal where created_at > now() - interval '24 hours' order by created_at desc limit 30`;
console.log('JOURNAL (24h):');
console.log(JSON.stringify(journal, null, 2));
await sql.end();
