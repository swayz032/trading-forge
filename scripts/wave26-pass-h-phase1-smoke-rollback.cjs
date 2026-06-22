require('dotenv/config');
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
  try {
    const ids = [
      '28c4fcd2-af28-4f1d-b6b4-8cbe8b1b5c50',
      '339d5527-5c9d-4e00-9f5c-6850ce21acf9',
      '1ad97a9f-e54a-435e-af89-6dc922ce4767',
      '0d78109a-0679-40be-acbf-348a99e25e2b',
      '2c82aeba-cfb8-4dbe-b925-6c695afa133d',
      '4e8b4f42-a49c-45a6-ac56-709db408019e',
    ];
    const r = await sql`
      UPDATE strategies
      SET archived_at = NULL,
          archive_reason = NULL
      WHERE id = ANY(${ids})
      RETURNING id, name, archived_at
    `;
    console.log("Rolled back archive on:");
    console.log(JSON.stringify(r, null, 2));

    // Also archive the 3 new strategies we just created to avoid library pollution
    const newIds = [
      'cf8a9552-9dfb-4e82-98dc-f9ad2ed5c52f',
      '66ad5518-31b8-4541-b93d-06c1ad14f30f',
      'ae1ecf9f-d58e-4247-9739-f562f5cae026',
    ];
    const n = await sql`
      UPDATE strategies
      SET archived_at = NOW(),
          archive_reason = 'wave26_pass_h_phase1_smoke_failed_rollback'
      WHERE id = ANY(${newIds})
      RETURNING id, name
    `;
    console.log("Archived smoke-test artifacts:");
    console.log(JSON.stringify(n, null, 2));

    await sql`
      INSERT INTO audit_log (action, entity_type, entity_id, input, result, status, decision_authority, correlation_id)
      VALUES (
        'wave26.pass_h_phase1.smoke_failed_rollback',
        'strategy_batch',
        NULL,
        ${JSON.stringify({ unarchived: ids, archived_smoke_artifacts: newIds })}::jsonb,
        ${JSON.stringify({ reason: 'gemma extractor emitted non-canonical concept name; entry_indicator fell through to ema_crossover regex; ict_bias_aligned_continuation never produced; smoke failed 4 of 7 sub-checks' })}::jsonb,
        'warning',
        'system',
        NULL
      )
    `;
  } finally { await sql.end(); }
})().catch(e => { console.error(e); process.exit(1); });
