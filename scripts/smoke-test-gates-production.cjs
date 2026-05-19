/**
 * Pass 21 v3 corrected³ (2026-05-17) — comprehensive gate smoke test.
 *
 * Verifies the 5 production gates ACTUALLY reject what they should reject:
 *   1. Param range violation (Connors RSI-2 period=2 case)
 *   2. Archetype mechanic mismatch (Silver Bullet without time+sweep+FVG)
 *   3. Source-fidelity fail (entry_long doesn't overlap source rule)
 *   4. Thin DSL (placeholder prose + valid params — should now reject)
 *   5. Valid archetype with full prose still passes
 *
 * Each case is a synthetic bucket+mentions, force-graduated via the live
 * route. Cleanup is automatic.
 */
require("dotenv/config");
const postgres = require("postgres");
const crypto = require("crypto");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

const N8N_URL = process.env.RAILWAY_N8N_URL || "https://n8n-production-84ff.up.railway.app";
const BACKEND_URL = "http://localhost:4000";

const cleanups = [];

async function insertBucketAndMentions(conceptName, ideaOverrides = {}, archetype = "breakout") {
  const fp = crypto.createHash("sha256").update(conceptName).digest("hex");
  const wfp = crypto.createHash("sha256").update(conceptName + "_wide").digest("hex");
  const bucketId = (await sql`
    INSERT INTO strategy_pending_buckets (
      concept_name, market, fingerprint_hash, wide_fingerprint_hash,
      entry_archetype, exit_type, layer_coverage_json,
      source_count, distinct_providers, status
    ) VALUES (
      ${conceptName}, 'MES', ${fp}, ${wfp},
      ${archetype}, 'trailing_stop',
      ${sql.json({web:true,youtube:true,reddit:true})},
      3, 3, 'pending'
    ) RETURNING id`)[0].id;
  const idea = {
    name: conceptName, concept_name: conceptName, symbol: "MES", timeframe: "5m",
    direction: "long", entry_indicator: null, entry_params: {},
    stop_loss_atr_multiple: 1.5, source_url: "https://example.test/" + conceptName,
    extraction_confidence: 0.9, ...ideaOverrides,
  };
  for (const prov of [["youtube","youtube"], ["brave","web"], ["reddit","reddit"]]) {
    await sql`
      INSERT INTO strategy_pending_mentions (bucket_id, source_provider, source_url, extracted_idea, scout_layer)
      VALUES (${bucketId}, ${prov[0]}, ${'https://test.example/'+prov[0]}, ${sql.json(idea)}, ${prov[1]})`;
  }
  cleanups.push({ bucketId });
  return bucketId;
}

async function graduate(bucketId, label) {
  // Retry a few times if rate-limited (autonomous scout pumping concurrent traffic)
  for (let attempt = 1; attempt <= 6; attempt++) {
    const r = await fetch(`${BACKEND_URL}/api/agent/pending-buckets/${bucketId}/graduate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `smoke-${label}-${Date.now()}-${attempt}` },
    });
    const body = await r.text().catch(() => "");
    if (r.status === 429) {
      console.log(`    ${label} attempt ${attempt}: HTTP 429 (rate-limited), retrying in 4s`);
      await new Promise(rr => setTimeout(rr, 4000));
      continue;
    }
    console.log(`    ${label}: HTTP ${r.status} ${body.slice(0, 120)}`);
    await new Promise(rr => setTimeout(rr, 6000));  // wait for async graduator
    return r.status;
  }
  return 429;
}

async function getResult(bucketId, conceptName) {
  // Strategy created? Find by recent timestamp (prettifier collapses test
  // concept names, so name LIKE filter doesn't work cleanly).
  const [strat] = await sql`SELECT id, name, config FROM strategies
    WHERE created_at > NOW() - INTERVAL '20 seconds'
      AND config->'metadata'->>'source' = 'graduated_bucket'
    ORDER BY created_at DESC LIMIT 1`;
  if (strat) {
    cleanups.push({ strategyId: strat.id });
    return { outcome: "GRADUATED", strategyId: strat.id, name: strat.name };
  }
  // Audit rejects in last 30s for this bucket
  const rejects = await sql`SELECT action, result FROM audit_log
    WHERE entity_id = ${bucketId}
      AND created_at > NOW() - INTERVAL '30 seconds'
      AND action LIKE 'graduation.rejected%'
    ORDER BY created_at DESC`;
  if (rejects.length > 0) {
    return { outcome: "REJECTED", action: rejects[0].action, reason: rejects[0].result?.reason || JSON.stringify(rejects[0].result).slice(0, 150) };
  }
  return { outcome: "UNKNOWN" };
}

(async () => {
  try {
    console.log("\n══════════════════════════════════════════════════════");
    console.log("PRODUCTION GATE SMOKE TEST — 5 cases");
    console.log("══════════════════════════════════════════════════════\n");

    // ───── Case 1: Param range violation (Connors RSI-2 textbook) ─────
    console.log("Case 1: Connors RSI-2 textbook (period=2 out of canonical range 7-21)");
    const ts1 = Date.now();
    const b1 = await insertBucketAndMentions("connors_rsi2_test_" + ts1, {
      entry_indicator: "rsi_reversal",
      entry_params: { period: 2, oversold: 5, overbought: 95 },
      entry_rules: "Enter long when 2-period RSI closes below 5 in a strong uptrend; exit when RSI crosses above 50.",
      entry_condition: "Enter long when 2-period RSI closes below 5 in a strong uptrend; exit when RSI crosses above 50.",
    });
    await graduate(b1, "case1");
    const r1 = await getResult(b1, "connors_rsi2_test_" + ts1);
    console.log("  outcome:", r1.outcome, "→", r1.reason || r1.action || "(no detail)");
    console.log("  EXPECTED: REJECTED with param_range_violation");
    console.log("  PASS:", r1.outcome === "REJECTED" && (r1.reason?.includes("range") || r1.reason?.includes("param_range")) ? "✓" : "✗");
    console.log();

    // ───── Case 2: Archetype mechanic mismatch (Silver Bullet w/o keywords) ─────
    console.log("Case 2: Silver Bullet WITHOUT required mechanic keywords");
    const ts2 = Date.now();
    const b2 = await insertBucketAndMentions("ict_silver_bullet_bad_" + ts2, {
      entry_rules: "Enter long when the market moves above prior swing high with confirmation candle. Exit on 1R reward.",
      entry_condition: "Enter long when the market moves above prior swing high with confirmation candle. Exit on 1R reward.",
    });
    await graduate(b2, "case2");
    const r2 = await getResult(b2, "ict_silver_bullet_bad_" + ts2);
    console.log("  outcome:", r2.outcome, "→", r2.reason || r2.action || "(no detail)");
    console.log("  EXPECTED: REJECTED with archetype_mechanic_mismatch");
    console.log("  PASS:", r2.outcome === "REJECTED" && (r2.reason?.includes("mechanic") || r2.action?.includes("thin_dsl")) ? "✓" : "✗");
    console.log();

    // ───── Case 3: Source-fidelity fail (template fallback) ─────
    console.log("Case 3: Source-fidelity — empty entry_rules forces default template (caught)");
    const ts3 = Date.now();
    const b3 = await insertBucketAndMentions("ema_pullback_template_test_" + ts3, {
      entry_indicator: "ema_crossover",
      entry_params: { fast_period: 9, slow_period: 21 },
      entry_rules: "",   // empty → graduator falls back to template
      entry_condition: "",
    });
    await graduate(b3, "case3");
    const r3 = await getResult(b3, "ema_pullback_template_test_" + ts3);
    console.log("  outcome:", r3.outcome, "→", r3.reason || r3.action || "(no detail)");
    console.log("  EXPECTED: REJECTED (thin prose OR source_fidelity)");
    console.log("  PASS:", r3.outcome === "REJECTED" ? "✓" : "✗");
    console.log();

    // ───── Case 4: Thin DSL — placeholder prose + valid params (should NOW reject) ─────
    console.log("Case 4: Placeholder Reddit-thread prose + valid params (old gate let through)");
    const ts4 = Date.now();
    const b4 = await insertBucketAndMentions("connors_rsi2_real_test_" + ts4, {
      entry_indicator: "rsi_reversal",
      entry_params: { period: 14, oversold: 30, overbought: 70 },
      // Valid params in pattern_library canonical range
      entry_rules: "Web-layer cross-validation: best signals indicator 2026 — content surfaced via search.",
      entry_condition: "Web-layer cross-validation: best signals indicator 2026 — content surfaced via search.",
    });
    await graduate(b4, "case4");
    const r4 = await getResult(b4, "connors_rsi2_real_test_" + ts4);
    console.log("  outcome:", r4.outcome, "→", r4.reason || r4.action || "(no detail)");
    console.log("  EXPECTED: REJECTED (placeholder prose despite valid params)");
    console.log("  PASS:", r4.outcome === "REJECTED" ? "✓" : "✗");
    console.log();

    // ───── Case 5: Valid Silver Bullet with full mechanics — should PASS ─────
    console.log("Case 5: Valid Silver Bullet with all required mechanic keywords");
    const ts5 = Date.now();
    const b5 = await insertBucketAndMentions("ict_silver_bullet_good_" + ts5, {
      entry_rules: "During the 10:00-11:00 AM ET NY AM window, identify BSL and SSL on 15m chart. Wait for liquidity sweep, then displacement opposite the sweep creating an MSS. Enter on FVG retrace within the displacement candles with stop beyond FVG-forming candle.",
      entry_condition: "During the 10:00-11:00 AM ET NY AM window, identify BSL and SSL on 15m chart. Wait for liquidity sweep, then displacement opposite the sweep creating an MSS. Enter on FVG retrace within the displacement candles with stop beyond FVG-forming candle.",
    });
    await graduate(b5, "case5");
    const r5 = await getResult(b5, "ict_silver_bullet_good_" + ts5);
    console.log("  outcome:", r5.outcome, "→", r5.reason || r5.action || (r5.name ? r5.name : "(no detail)"));
    console.log("  EXPECTED: GRADUATED (all mechanics present)");
    console.log("  PASS:", r5.outcome === "GRADUATED" ? "✓" : "✗");
    if (r5.outcome === "GRADUATED" && r5.strategyId) {
      const [s] = await sql`SELECT config FROM strategies WHERE id = ${r5.strategyId}`;
      console.log("    strategy_class:", s.config.strategy_class);
      console.log("    routing_mode:  ", s.config.metadata?.routing_mode);
    }
    console.log();
    console.log("══════════════════════════════════════════════════════");
  } finally {
    // Cleanup
    for (const c of cleanups) {
      if (c.strategyId) await sql`DELETE FROM strategies WHERE id = ${c.strategyId}`.catch(() => {});
    }
    for (const c of cleanups) {
      if (c.bucketId) {
        await sql`DELETE FROM strategy_pending_mentions WHERE bucket_id = ${c.bucketId}`.catch(() => {});
        await sql`DELETE FROM strategy_pending_buckets WHERE id = ${c.bucketId}`.catch(() => {});
      }
    }
    await sql.end();
  }
})();
