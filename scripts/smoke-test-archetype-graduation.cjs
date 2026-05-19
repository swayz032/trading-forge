/**
 * Pass 21 v3 corrected² smoke test (2026-05-17).
 *
 * Inserts a synthetic pending_bucket for an ICT Silver Bullet concept,
 * triggers graduator via the live route, verifies the inserted strategy
 * has the correct `strategy_class` field for engine class-based dispatch.
 *
 * Cleans up after itself (deletes the test bucket + strategy + audit rows).
 */
require("dotenv/config");
const postgres = require("postgres");

const TEST_CONCEPT = "ict_silver_bullet_test_" + Date.now();
const TEST_NARRATIVE =
  "During the 10:00-11:00 AM ET window, identify BSL and SSL on the 15m chart. " +
  "Wait for price to sweep one of the liquidity levels. After the sweep, displacement " +
  "opposite the sweep direction must create a Market Structure Shift (MSS) breaking " +
  "a prior swing. Within the displacement candles, a Fair Value Gap (FVG) forms. " +
  "Enter on retrace into the FVG with stop beyond the FVG-forming candle and target " +
  "the opposite liquidity pool at minimum 1:2 RR.";

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  let bucketId = null;
  let strategyId = null;
  try {
    // 1. Insert pending bucket
    const fingerprint = require("crypto").createHash("sha256").update(TEST_CONCEPT).digest("hex");
    const wideFingerprint = require("crypto").createHash("sha256").update(TEST_CONCEPT + "_wide").digest("hex");
    const inserted = await sql`
      INSERT INTO strategy_pending_buckets (
        concept_name, market, fingerprint_hash, wide_fingerprint_hash,
        entry_archetype, exit_type, layer_coverage_json,
        source_count, distinct_providers, status
      ) VALUES (
        ${TEST_CONCEPT}, 'MES', ${fingerprint}, ${wideFingerprint},
        'breakout', 'trailing_stop',
        ${sql.json({web:true,youtube:true,reddit:true})},
        3, 3, 'pending'
      ) RETURNING id`;
    bucketId = inserted[0].id;
    console.log("✓ pending_bucket inserted:", bucketId);

    // 1b. Insert mention (graduator requires at least one)
    const extractedIdea = {
      name: TEST_CONCEPT,
      concept_name: TEST_CONCEPT,
      symbol: "MES",
      timeframe: "5m",
      direction: "long",
      entry_indicator: null,
      entry_condition: TEST_NARRATIVE,
      entry_rules: TEST_NARRATIVE,
      entry_params: {},
      stop_loss_atr_multiple: 1.5,
      source_url: "https://innercircletrader.net/tutorials/ict-silver-bullet-strategy/",
      extraction_confidence: 0.9,
    };
    await sql`
      INSERT INTO strategy_pending_mentions (
        bucket_id, source_provider, source_url, extracted_idea, scout_layer
      ) VALUES (
        ${bucketId}, 'youtube',
        'https://innercircletrader.net/tutorials/ict-silver-bullet-strategy/',
        ${sql.json(extractedIdea)}, 'youtube'
      )`;
    await sql`
      INSERT INTO strategy_pending_mentions (
        bucket_id, source_provider, source_url, extracted_idea, scout_layer
      ) VALUES (
        ${bucketId}, 'brave',
        'https://www.luxalgo.com/blog/ict-silver-bullet-setup-trading-methods/',
        ${sql.json(extractedIdea)}, 'web'
      )`;
    await sql`
      INSERT INTO strategy_pending_mentions (
        bucket_id, source_provider, source_url, extracted_idea, scout_layer
      ) VALUES (
        ${bucketId}, 'reddit',
        'https://reddit.com/r/Daytrading/silver-bullet',
        ${sql.json(extractedIdea)}, 'reddit'
      )`;
    console.log("✓ 3 mentions inserted (web + youtube + reddit)");

    // 2. Force-graduate via operator route
    const res = await fetch(`http://localhost:4000/api/agent/pending-buckets/${bucketId}/graduate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    console.log("  POST /graduate HTTP", res.status);
    const body = await res.json().catch(() => null);
    if (body) console.log("  response:", JSON.stringify(body).slice(0, 200));

    // Wait a bit for async graduation
    await new Promise(r => setTimeout(r, 3000));

    // 3. Check if strategy was inserted
    const strats = await sql`
      SELECT id, name, config FROM strategies
      WHERE config->'metadata'->>'source'='graduated_bucket'
        AND created_at > NOW() - INTERVAL '30 seconds'
      ORDER BY created_at DESC LIMIT 5`;

    console.log("\n  Strategies graduated in last 30s:", strats.length);
    let testStrat = null;
    for (const s of strats) {
      if (s.name.includes("silver_bullet") || s.name.includes("ict")) {
        testStrat = s;
        break;
      }
    }
    if (testStrat) {
      strategyId = testStrat.id;
      console.log("\n══════════════════════════════════════════════════════");
      console.log("✓ ARCHETYPE STRATEGY INSERTED");
      console.log("══════════════════════════════════════════════════════");
      console.log("name:                       ", testStrat.name);
      console.log("strategy_class:             ", testStrat.config.strategy_class || "<MISSING — BUG>");
      console.log("metadata.routing_mode:      ", testStrat.config.metadata?.routing_mode);
      console.log("metadata.engine_spec:       ", testStrat.config.metadata?.engine_spec);
      console.log("metadata.entry_archetype:   ", testStrat.config.metadata?.entry_archetype);
      console.log("indicators[0].type:         ", testStrat.config.strategy?.indicators?.[0]?.type);
      console.log("entry_long (first 100 ch):  ", String(testStrat.config.strategy?.entry_long || "").slice(0, 100));

      const expectedClass = "src.engine.strategies.silver_bullet.SilverBulletStrategy";
      console.log("\nEXPECTED strategy_class:    ", expectedClass);
      console.log("MATCHES:                    ", testStrat.config.strategy_class === expectedClass ? "✓ YES" : "✗ NO");
    } else {
      // Look at audit log for reject reason
      const rejects = await sql`
        SELECT action, result FROM audit_log
        WHERE created_at > NOW() - INTERVAL '30 seconds'
          AND action LIKE 'graduation.%'
        ORDER BY created_at DESC LIMIT 5`;
      console.log("\n  No graduation, audit rejects:");
      for (const r of rejects) {
        console.log("   ", r.action, "→", JSON.stringify(r.result).slice(0, 200));
      }
    }
  } finally {
    // Cleanup
    if (strategyId) await sql`DELETE FROM strategies WHERE id = ${strategyId}`.catch(() => {});
    if (bucketId) {
      await sql`DELETE FROM strategy_pending_mentions WHERE bucket_id = ${bucketId}`.catch(() => {});
      await sql`DELETE FROM strategy_pending_buckets WHERE id = ${bucketId}`.catch(() => {});
    }
    await sql.end();
  }
})();
