const pg = require('postgres');
const fs = require('fs');
const url = fs.readFileSync('.env', 'utf-8').match(/^DATABASE_URL=(.+)$/m)[1].trim();
const sql = pg(url, { max: 1 });
(async () => {
  console.log('=== Check source_url_first_seen + description coverage ===\n');

  const rows = await sql`
    SELECT
      s.id, s.name, s.symbol,
      s.config->>'source_url' AS config_url,
      s.config->>'source_url_first_seen' AS config_first_seen,
      s.config->'audit'->>'source_url' AS audit_url,
      s.description,
      s.parent_strategy_id
    FROM strategies s
    WHERE s.archived_at IS NULL
    ORDER BY s.name
  `;

  let withConfigUrl = 0, withFirstSeen = 0, withAudit = 0, withParent = 0, neither = 0;
  const titlesFromDesc = new Map();
  for (const r of rows) {
    if (r.config_first_seen) withFirstSeen++;
    if (r.config_url) withConfigUrl++;
    if (r.audit_url) withAudit++;
    if (r.parent_strategy_id) withParent++;
    if (!r.config_first_seen && !r.config_url && !r.audit_url) {
      neither++;
      const m = (r.description || '').match(/extracted from (.+?)(?:\.|$)/i);
      if (m) {
        const title = m[1].trim();
        if (!titlesFromDesc.has(title)) titlesFromDesc.set(title, []);
        titlesFromDesc.get(title).push(r.symbol);
      }
    }
  }

  console.log(`Total alive:                ${rows.length}`);
  console.log(`With config.source_url:           ${withConfigUrl}`);
  console.log(`With config.source_url_first_seen: ${withFirstSeen}`);
  console.log(`With config.audit.source_url:     ${withAudit}`);
  console.log(`With parent_strategy_id (variant):${withParent}`);
  console.log(`With NEITHER url field:           ${neither}`);
  console.log(`Unique titles from desc:    ${titlesFromDesc.size}\n`);

  // If a strategy has parent_strategy_id, try to resolve via parent's URL
  console.log('=== Resolving 105 no-URL strategies via parent_strategy_id chain ===');
  const noUrlIds = rows.filter(r => !r.config_first_seen && !r.config_url && !r.audit_url && r.parent_strategy_id).map(r => r.parent_strategy_id);
  if (noUrlIds.length > 0) {
    const parents = await sql`
      SELECT id, name, config->>'source_url' AS url, config->>'source_url_first_seen' AS first_seen, config->'audit'->>'source_url' AS audit_url
      FROM strategies WHERE id = ANY(${noUrlIds})`;
    let resolvedViaParent = 0;
    for (const p of parents) {
      if (p.url || p.first_seen || p.audit_url) resolvedViaParent++;
    }
    console.log(`  Strategies with parent: ${noUrlIds.length}`);
    console.log(`  Parents that have URL:  ${resolvedViaParent}/${parents.length}`);
  } else {
    console.log('  No strategies have parent_strategy_id set.');
  }

  console.log('\n=== Unique titles from descriptions (first 30) ===');
  let j = 0;
  for (const [title, syms] of titlesFromDesc) {
    console.log(`  [${syms.length}× ${syms.sort().join('/')}] "${title}"`);
    if (++j >= 30) break;
  }

  await sql.end();
})().catch(e => console.error('ERR', e.message));
