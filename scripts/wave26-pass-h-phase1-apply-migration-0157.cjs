require('dotenv/config');
const postgres = require('postgres');
const fs = require('fs');
const path = require('path');

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const sqlText = fs.readFileSync(
      path.resolve(__dirname, '..', 'src/server/db/migrations/0157_normalize_factor_quality_strings.sql'),
      'utf-8'
    );
    // Strip pure comment lines + single comment-only statements
    const stmt = sqlText
      .split('\n')
      .filter(l => !l.trim().startsWith('--'))
      .join('\n')
      .trim();

    console.log('=== Migration 0157 ===');
    console.log(stmt);
    console.log('===');

    const result = await sql.unsafe(stmt);
    console.log('rows affected:', result.count);

    // Verify
    const post = await sql`SELECT config->'entry_quality'->>'factor_quality' as fq, COUNT(*)::int as n FROM strategies WHERE archived_at IS NULL GROUP BY 1 ORDER BY 2 DESC`;
    console.log('POST distribution:');
    console.log(JSON.stringify(post, null, 2));
  } finally {
    await sql.end();
  }
})().catch(e => { console.error(e); process.exit(1); });
