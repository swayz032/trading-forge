/**
 * Pine Broker Reconcile CLI
 *
 * Automated Strategy Tester vs broker paper fill reconciliation.
 * Closes CLAUDE.md §7 gap: "no automated Strategy-Tester-vs-broker P&L reconciliation harness"
 *
 * Usage:
 *   npx tsx scripts/pine-broker-reconcile.ts \
 *     --strategy <uuid>          Required. Strategy ID to reconcile.
 *     --csv <path>               Required. Path to TradingView Strategy Tester CSV export.
 *     [--since <iso>]            Optional ISO timestamp. Only broker trades with exitTime >= since.
 *                                Defaults to 30 days ago.
 *     [--tolerance-ticks <n>]    Optional. Tick tolerance per leg. Default: 2.
 *
 * Output:
 *   Markdown reconciliation report printed to stdout.
 *   One audit_log row written with action=pine_parity.reconciliation_run (fail-soft).
 *
 * Exit codes:
 *   0 — reconciliation ran (within_tolerance may be false; check report)
 *   1 — fatal argument / DB / file error
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../src/server/db/index.js";
import { paperSessions, paperTrades, strategies } from "../src/server/db/schema.js";
import { eq, and, gte, inArray } from "drizzle-orm";
import { insertAuditRowSafe } from "../src/server/lib/audit-log-helper.js";
import {
  parseStrategyTesterCsv,
  matchTrades,
  reconcile,
  getTickSpec,
  type BrokerTrade,
  type ReconcileReport,
} from "../src/server/lib/pine-broker-reconcile.js";

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  strategyId: string;
  csvPath: string;
  since: Date;
  toleranceTicks: number;
} {
  const args = argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const strategyId = get("--strategy");
  const csvPath = get("--csv");
  const sinceRaw = get("--since");
  const toleranceRaw = get("--tolerance-ticks");

  if (!strategyId) {
    console.error("Error: --strategy <uuid> is required");
    process.exit(1);
  }
  if (!csvPath) {
    console.error("Error: --csv <path> is required");
    process.exit(1);
  }

  const since = sinceRaw
    ? new Date(sinceRaw)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (isNaN(since.getTime())) {
    console.error(`Error: --since value "${sinceRaw}" is not a valid ISO date`);
    process.exit(1);
  }

  const toleranceTicks = toleranceRaw ? parseInt(toleranceRaw, 10) : 2;
  if (isNaN(toleranceTicks) || toleranceTicks < 0) {
    console.error(`Error: --tolerance-ticks must be a non-negative integer`);
    process.exit(1);
  }

  return { strategyId, csvPath, since, toleranceTicks };
}

// ─── Markdown Report Builder ─────────────────────────────────────────────────

function buildReport(
  report: ReconcileReport,
  meta: {
    strategyId: string;
    strategyName: string;
    symbol: string;
    csvPath: string;
    since: Date;
    toleranceTicks: number;
    generatedAt: Date;
  }
): string {
  const verdict = report.within_tolerance ? "PASS" : "FAIL";
  const verdictMark = report.within_tolerance ? "PASS" : "FAIL";

  const lines: string[] = [
    "# Pine Broker Reconciliation Report",
    "",
    `**Strategy:** \`${meta.strategyId}\` — ${meta.strategyName}`,
    `**Symbol:** ${meta.symbol}`,
    `**CSV:** ${meta.csvPath}`,
    `**Since:** ${meta.since.toISOString()}`,
    `**Tolerance:** ${meta.toleranceTicks} ticks per leg`,
    `**Generated:** ${meta.generatedAt.toISOString()}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Matched trades | ${report.matched_count} |`,
    `| Unmatched tester | ${report.unmatched_tester} |`,
    `| Unmatched broker | ${report.unmatched_broker} |`,
    `| Max price delta | ${report.max_abs_price_delta_ticks.toFixed(2)} ticks |`,
    `| Cumulative P&L delta | $${report.cum_pnl_delta.toFixed(2)} |`,
    `| **Verdict** | **${verdictMark}** |`,
    "",
  ];

  if (report.per_trade.length > 0) {
    lines.push("## Per-Trade Detail", "");
    lines.push(
      "| Trade # | Dir | Entry Slip (ticks) | Exit Slip (ticks) | P&L Delta | Tolerance |",
      "|---------|-----|--------------------|-------------------|-----------|-----------|"
    );
    for (const t of report.per_trade) {
      const tol = t.withinTolerance ? "PASS" : "FAIL";
      lines.push(
        `| ${t.testerTradeNum} | ${t.direction} | ${t.entrySlipTicks.toFixed(2)} | ${t.exitSlipTicks.toFixed(2)} | $${t.pnlDelta.toFixed(2)} | ${tol} |`
      );
    }
    lines.push("");
  }

  lines.push("## Unmatched Tester Trades", "");
  if (report.unmatched_tester === 0) {
    lines.push("(none)", "");
  } else {
    lines.push(`${report.unmatched_tester} tester trade(s) could not be matched to broker fills.`, "");
  }

  lines.push("## Unmatched Broker Trades", "");
  if (report.unmatched_broker === 0) {
    lines.push("(none)", "");
  } else {
    lines.push(`${report.unmatched_broker} broker trade(s) could not be matched to tester trades.`, "");
  }

  lines.push(
    "---",
    "",
    `*pine_parity.reconciliation_run | verdict=${verdict}*`
  );

  return lines.join("\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { strategyId, csvPath, since, toleranceTicks } = parseArgs(process.argv);

  // ── Load CSV ──────────────────────────────────────────────────────────────

  const resolvedCsv = path.resolve(csvPath);
  if (!fs.existsSync(resolvedCsv)) {
    console.error(`Error: CSV file not found: ${resolvedCsv}`);
    process.exit(1);
  }
  const csvText = fs.readFileSync(resolvedCsv, "utf-8");

  let testerTrades;
  try {
    testerTrades = parseStrategyTesterCsv(csvText);
  } catch (err) {
    console.error(`Error parsing CSV: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── Load Strategy ─────────────────────────────────────────────────────────

  const strategyRows = await db
    .select({ id: strategies.id, name: strategies.name, symbol: strategies.symbol })
    .from(strategies)
    .where(eq(strategies.id, strategyId))
    .limit(1);

  if (strategyRows.length === 0) {
    console.error(`Error: Strategy not found: ${strategyId}`);
    process.exit(1);
  }

  const strategy = strategyRows[0];
  const tickSpec = getTickSpec(strategy.symbol);

  // ── Load Broker Trades ────────────────────────────────────────────────────

  const sessionRows = await db
    .select({ id: paperSessions.id })
    .from(paperSessions)
    .where(eq(paperSessions.strategyId, strategyId));

  const sessionIds = sessionRows.map((r) => r.id);

  let brokerTrades: BrokerTrade[] = [];
  if (sessionIds.length > 0) {
    const tradeRows = await db
      .select({
        side: paperTrades.side,
        entryPrice: paperTrades.entryPrice,
        exitPrice: paperTrades.exitPrice,
        pnl: paperTrades.pnl,
        contracts: paperTrades.contracts,
        entryTime: paperTrades.entryTime,
        exitTime: paperTrades.exitTime,
      })
      .from(paperTrades)
      .where(
        and(
          inArray(paperTrades.sessionId, sessionIds),
          gte(paperTrades.exitTime, since)
        )
      )
      .orderBy(paperTrades.entryTime);

    brokerTrades = tradeRows.map((r) => ({
      entryTime: r.entryTime,
      exitTime: r.exitTime,
      direction: r.side as "long" | "short",
      qty: r.contracts,
      entryPrice: parseFloat(r.entryPrice),
      exitPrice: parseFloat(r.exitPrice),
      pnl: parseFloat(r.pnl),
    }));
  }

  // ── Reconcile ─────────────────────────────────────────────────────────────

  const matchResult = matchTrades(testerTrades, brokerTrades, {
    windowMs: 5 * 60 * 1000,
  });

  const report = reconcile(matchResult, {
    tickSize: tickSpec.tickSize,
    tickValue: tickSpec.tickValue,
    tolerance_ticks: toleranceTicks,
  });

  // ── Print Markdown Report ─────────────────────────────────────────────────

  const generatedAt = new Date();
  const markdown = buildReport(report, {
    strategyId,
    strategyName: strategy.name,
    symbol: strategy.symbol,
    csvPath: resolvedCsv,
    since,
    toleranceTicks,
    generatedAt,
  });

  console.log(markdown);

  // ── Write Audit Row (fail-soft) ───────────────────────────────────────────

  await insertAuditRowSafe({
    action: "pine_parity.reconciliation_run",
    entityType: "strategy",
    entityId: strategyId,
    input: {
      csvPath: resolvedCsv,
      since: since.toISOString(),
      toleranceTicks,
      testerTradeCount: testerTrades.length,
      brokerTradeCount: brokerTrades.length,
    },
    result: {
      matched_count: report.matched_count,
      unmatched_tester: report.unmatched_tester,
      unmatched_broker: report.unmatched_broker,
      max_abs_price_delta_ticks: report.max_abs_price_delta_ticks,
      cum_pnl_delta: report.cum_pnl_delta,
      within_tolerance: report.within_tolerance,
    },
    status: report.within_tolerance ? "pass" : "fail",
    decisionAuthority: "OPERATOR",
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
