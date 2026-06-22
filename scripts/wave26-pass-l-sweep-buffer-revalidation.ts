/**
 * wave26-pass-l-sweep-buffer-revalidation.ts — Wave 26 Pass L Tweak 3 (2026-05-27)
 *
 * Reports the distribution of `stop_reason` values from audit_log over a
 * rolling 90-day window, per symbol. Operator runs this monthly (or via cron
 * — not yet scheduled, manual for now) to verify the empirical sweep-buffer
 * values (MES=3, MNQ=5, MCL=2 ticks) are still calibrated correctly.
 *
 * INTERPRETATION (per structural_stops.py header):
 *   - sweep_wick > 40% for a symbol → buffer too tight; sweeps are pushing
 *     through. Widen by +1 tick via STOP_BUFFER_TICKS_<SYMBOL> env override.
 *   - sweep_wick < 5%  for a symbol → buffer too wide; stops sitting too far
 *     from price. Tighten by -1 tick.
 *   - 5% ≤ sweep_wick ≤ 40% → in range, leave alone.
 *
 * Usage:
 *   npx tsx scripts/wave26-pass-l-sweep-buffer-revalidation.ts
 *   npx tsx scripts/wave26-pass-l-sweep-buffer-revalidation.ts --days=30
 *   npx tsx scripts/wave26-pass-l-sweep-buffer-revalidation.ts --json
 *
 * Exit codes:
 *   0 — all symbols in healthy 5%-40% sweep_wick range
 *   1 — at least one symbol out of range (operator action needed)
 */

import "../src/server/load-env.js";
import { db } from "../src/server/db/index.js";
import { sql } from "drizzle-orm";

interface StopReasonRow extends Record<string, unknown> {
  symbol: string;
  stop_reason: string;
  count: number;
}

interface PerSymbolStats {
  symbol: string;
  total: number;
  byReason: Record<string, number>;
  sweepWickPct: number;
  status: "healthy" | "buffer_too_tight" | "buffer_too_wide" | "no_data";
  recommendation: string;
}

const HEALTHY_MIN = 0.05;
const HEALTHY_MAX_DEFAULT = 0.40;
const HEALTHY_MAX: Record<string, number> = { MES: 0.40, MNQ: 0.40, MCL: 0.40 };

const argv = process.argv.slice(2);
const daysArg = argv.find((a) => a.startsWith("--days="));
const days = daysArg ? parseInt(daysArg.split("=")[1], 10) : 90;
const asJson = argv.includes("--json");

async function main() {
  const rows = await db.execute<StopReasonRow>(sql`
    SELECT
      COALESCE(input->>'symbol', 'UNKNOWN') AS symbol,
      COALESCE(result->>'stop_reason', 'unknown') AS stop_reason,
      COUNT(*)::int AS count
    FROM audit_log
    WHERE action = 'paper.stop_triggered'
      AND created_at >= NOW() - INTERVAL '${sql.raw(String(days))} days'
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC
  `);
  const data = [...rows];

  const bySymbol = new Map<string, Record<string, number>>();
  for (const row of data) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, {});
    bySymbol.get(row.symbol)![row.stop_reason] = row.count;
  }

  const stats: PerSymbolStats[] = [];
  for (const [symbol, byReason] of bySymbol.entries()) {
    const total = Object.values(byReason).reduce((a, b) => a + b, 0);
    const sweepWick = byReason["sweep_wick"] ?? 0;
    const sweepWickPct = total > 0 ? sweepWick / total : 0;
    const maxOk = HEALTHY_MAX[symbol] ?? HEALTHY_MAX_DEFAULT;

    let status: PerSymbolStats["status"];
    let recommendation: string;
    if (total === 0) {
      status = "no_data";
      recommendation = "Insufficient data — re-run after more trades accumulate.";
    } else if (sweepWickPct > maxOk) {
      status = "buffer_too_tight";
      recommendation = `WIDEN buffer by +1 tick: set STOP_BUFFER_TICKS_${symbol} higher (current 3/5/2 default).`;
    } else if (sweepWickPct < HEALTHY_MIN) {
      status = "buffer_too_wide";
      recommendation = `TIGHTEN buffer by -1 tick: set STOP_BUFFER_TICKS_${symbol} lower (current 3/5/2 default).`;
    } else {
      status = "healthy";
      recommendation = "In range. No action needed.";
    }
    stats.push({ symbol, total, byReason, sweepWickPct, status, recommendation });
  }

  const hasUnhealthy = stats.some((s) => s.status === "buffer_too_tight" || s.status === "buffer_too_wide");

  if (asJson) {
    console.log(JSON.stringify({ windowDays: days, stats, hasUnhealthy }, null, 2));
  } else {
    console.log(`\nSweep-buffer re-validation — last ${days} days\n${"─".repeat(70)}`);
    for (const s of stats) {
      console.log(`\n${s.symbol}  (${s.total} stops triggered total)`);
      for (const [reason, count] of Object.entries(s.byReason).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / Math.max(s.total, 1)) * 100).toFixed(1).padStart(5);
        console.log(`  ${reason.padEnd(28)} ${count.toString().padStart(6)}  ${pct}%`);
      }
      const emoji = s.status === "healthy" ? "✅" : s.status === "no_data" ? "⚪" : "⚠️";
      console.log(`  ${emoji} sweep_wick rate: ${(s.sweepWickPct * 100).toFixed(1)}%`);
      console.log(`  → ${s.recommendation}`);
    }
    console.log(`\n${"─".repeat(70)}`);
    console.log(hasUnhealthy ? "⚠️  Action needed on at least one symbol." : "✅ All symbols in healthy range.");
  }

  process.exit(hasUnhealthy ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(2); });
