const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });

(async () => {
  console.log('=== Apply 0159 column + check constraint only (skip seed INSERT — broker_accounts firm_id check blocks it) ===');
  await sql`ALTER TABLE strategies ADD COLUMN IF NOT EXISTS paper_account_routing TEXT NOT NULL DEFAULT 'baseline'`;
  await sql`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'strategies_paper_account_routing_check'
    ) THEN
      ALTER TABLE strategies
        ADD CONSTRAINT strategies_paper_account_routing_check
        CHECK (paper_account_routing IN ('baseline', 'rl-challenger'));
    END IF;
  END $$`;
  console.log('  ✓ column + check constraint applied');

  console.log('\n=== Verify ===');
  const r = await sql`SELECT 1 FROM information_schema.columns WHERE table_name='strategies' AND column_name='paper_account_routing'`;
  console.log('paper_account_routing →', r.length > 0 ? 'present ✓' : 'STILL MISSING ✗');

  console.log('\n=== broker_accounts firm_id CHECK constraint definition ===');
  const cc = await sql`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'broker_accounts'::regclass AND conname LIKE '%firm_id%'
  `;
  for (const c of cc) console.log(c.def);

  await sql.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
