/**
 * Pass 21 v3 corrected² (2026-05-17) — verify archetype strategy actually
 * dispatches to --strategy-class when backtested. We don't run a full
 * backtest (would need data + minutes); we trigger the route and check
 * that the backtest row records the strategy_class in its config.
 */
require("dotenv/config");
const postgres = require("postgres");

(async () => {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  let bucketId = null;
  let strategyId = null;
  let backtestId = null;
  try {
    // Reuse the graduation script's bucket-creation logic inline
    const TEST_CONCEPT = "ict_silver_bullet_dispatch_test_" + Date.now();
    const crypto = require("crypto");
    const fingerprint = crypto.createHash("sha256").update(TEST_CONCEPT).digest("hex");
    const wideFingerprint = crypto.createHash("sha256").update(TEST_CONCEPT + "_wide").digest("hex");
    const NARRATIVE =
      "During the 10:00-11:00 AM ET window, identify BSL and SSL on the 15m chart. " +
      "Wait for sweep, then displacement creating MSS, then enter on FVG retrace.";

    bucketId = (await sql`
      INSERT INTO strategy_pending_buckets (
        concept_name, market, fingerprint_hash, wide_fingerprint_hash,
        entry_archetype, exit_type, layer_coverage_json,
        source_count, distinct_providers, status
      ) VALUES (
        ${TEST_CONCEPT}, 'MES', ${fingerprint}, ${wideFingerprint},
        'breakout', 'trailing_stop',
        ${sql.json({web:true,youtube:true,reddit:true})},
        3, 3, 'pending'
      ) RETURNING id`)[0].id;

    const idea = {
      name: TEST_CONCEPT, concept_name: TEST_CONCEPT,
      symbol: "MES", timeframe: "5m", direction: "long",
      entry_indicator: null, entry_condition: NARRATIVE, entry_rules: NARRATIVE,
      entry_params: {}, stop_loss_atr_multiple: 1.5,
      source_url: "https://innercircletrader.net/tutorials/ict-silver-bullet-strategy/",
      extraction_confidence: 0.9,
    };
    for (const prov of [["youtube","youtube"], ["brave","web"], ["reddit","reddit"]]) {
      await sql`
        INSERT INTO strategy_pending_mentions (bucket_id, source_provider, source_url, extracted_idea, scout_layer)
        VALUES (${bucketId}, ${prov[0]}, ${'https://test.example/'+prov[0]}, ${sql.json(idea)}, ${prov[1]})`;
    }
    console.log("✓ test bucket + 3 mentions inserted:", bucketId);

    // Force graduate
    const r = await fetch(`http://localhost:4000/api/agent/pending-buckets/${bucketId}/graduate`, { method: "POST" });
    console.log("  graduate HTTP", r.status);
    await new Promise(r => setTimeout(r, 3000));

    const [strat] = await sql`
      SELECT id, name, symbol, timeframe, config FROM strategies
      WHERE name LIKE 'ict_silver_bullet%' AND created_at > NOW() - INTERVAL '30 seconds'
      ORDER BY created_at DESC LIMIT 1`;
    if (!strat) throw new Error("Strategy not graduated");
    strategyId = strat.id;
    console.log("✓ strategy graduated:", strat.name, "id=", strategyId);
    console.log("  config.strategy_class:", strat.config.strategy_class);

    // Trigger a backtest
    const start = "2024-01-02";
    const end = "2024-01-09";
    const btRes = await fetch("http://localhost:4000/api/backtests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyId,
        start_date: start,
        end_date: end,
        mode: "single",
      }),
    });
    console.log("\n  POST /api/backtests HTTP", btRes.status);
    const btBody = await btRes.json().catch(() => null);
    if (btBody) console.log("  response:", JSON.stringify(btBody).slice(0, 300));
    backtestId = btBody?.backtest_id || btBody?.backtestId;

    // Wait briefly + check backtest row
    if (backtestId) {
      await new Promise(r => setTimeout(r, 4000));
      const [bt] = await sql`SELECT id, status, error_message, config FROM backtests WHERE id = ${backtestId}`;
      if (bt) {
        console.log("\n══════════════════════════════════════════════════════");
        console.log("BACKTEST ROW STATE");
        console.log("══════════════════════════════════════════════════════");
        console.log("status:        ", bt.status);
        console.log("error:         ", bt.error_message || "(none)");
        console.log("config.strategy_class:", bt.config?.strategy_class || "<missing — would NOT dispatch>");
        console.log("\nDISPATCH PATH:", bt.config?.strategy_class
          ? "✓ class-based (--strategy-class " + bt.config.strategy_class + ")"
          : "✗ DSL path (pattern_library validate)");
      }
    }

    // Check log lines for actual --strategy-class arg
    const { execSync } = require("child_process");
    try {
      const logs = execSync(`pm2 logs trading-forge-api --lines 40 --nostream 2>&1`, { encoding: "utf-8" });
      const match = logs.match(/--strategy-class[\s\S]{0,200}/);
      if (match) console.log("\n✓ pm2 logs confirm --strategy-class CLI flag used:\n   ", match[0].split("\n")[0]);
    } catch {}
  } finally {
    if (backtestId) await sql`DELETE FROM backtests WHERE id = ${backtestId}`.catch(() => {});
    if (strategyId) await sql`DELETE FROM strategies WHERE id = ${strategyId}`.catch(() => {});
    if (bucketId) {
      await sql`DELETE FROM strategy_pending_mentions WHERE bucket_id = ${bucketId}`.catch(() => {});
      await sql`DELETE FROM strategy_pending_buckets WHERE id = ${bucketId}`.catch(() => {});
    }
    await sql.end();
  }
})();
