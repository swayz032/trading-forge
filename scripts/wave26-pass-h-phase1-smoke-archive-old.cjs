require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    // 6 fragmented strategies from dE4lPhAWke8 (3 BoS + 3 MSS)
    const ids = [
      '28c4fcd2-af28-4f1d-b6b4-8cbe8b1b5c50', // BoS MES
      '339d5527-5c9d-4e00-9f5c-6850ce21acf9', // BoS MNQ
      '1ad97a9f-e54a-435e-af89-6dc922ce4767', // BoS MCL
      '0d78109a-0679-40be-acbf-348a99e25e2b', // MSS MES
      '2c82aeba-cfb8-4dbe-b925-6c695afa133d', // MSS MNQ
      '4e8b4f42-a49c-45a6-ac56-709db408019e', // MSS MCL
    ];
    const r = await sql`
      UPDATE strategies
      SET archived_at = NOW(),
          archive_reason = 'wave26_pass_h_smoke_test_reingest'
      WHERE id = ANY(${ids})
      RETURNING id, name, archived_at, archive_reason
    `;
    console.log("Archived strategies:");
    console.log(JSON.stringify(r, null, 2));

    // 2 pending buckets from same video — revert to allow re-cross-validation
    const bids = [
      '83ef2e28-c23b-407e-a3c6-1e84ddbd71aa', // BoS bucket (graduated)
      '98edb174-9881-4de8-bb2c-42c3724c7b14', // MSS bucket (graduated)
      '80618248-222a-4521-99b4-2a4c7ce141e5', // fvg_retrace pending
      'c93501e4-fd59-4a3f-b2c8-4ea074cc2a4d', // liquidity_targeting pending
    ];
    const b = await sql`
      UPDATE strategy_pending_buckets
      SET status = 'pending',
          graduated_at = NULL,
          graduated_strategy_id = NULL
      WHERE id = ANY(${bids})
      RETURNING id, concept_name, status
    `;
    console.log("Reset buckets:");
    console.log(JSON.stringify(b, null, 2));

    // Write audit row marking the archive batch
    await sql`
      INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority, correlation_id)
      VALUES (
        'wave26.pass_h_phase1.smoke_archive',
        'strategy_batch',
        NULL,
        ${JSON.stringify({ archived_strategy_ids: ids, reset_bucket_ids: bids, source_video: 'dE4lPhAWke8' })}::jsonb,
        ${JSON.stringify({ archived_count: r.length, reset_count: b.length })}::jsonb,
        'success',
        'system',
        NULL
      )
    `;
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
