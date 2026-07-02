/**
 * Pine Script Strategy Tester vs Broker Paper Fill Reconciliation Library
 *
 * Closes CLAUDE.md §7 parity gap:
 *   "no automated Strategy-Tester-vs-broker P&L reconciliation harness"
 *
 * PURE functions only — no DB, no IO, no Date.now().
 * Replay-deterministic and safe for test fixtures.
 *
 * Export path: pine_export_preparation subsystem
 * Audit action: pine_parity.reconciliation_run
 *
 * Per-symbol tick spec (CLAUDE.md §8 + prop-firm micro-futures):
 *   MES: 0.25 price / $1.25 per tick
 *   MNQ: 0.25 price / $0.50 per tick
 *   MCL: 0.01 price / $1.00 per tick
 *
 * Tolerance default: 2 ticks per CLAUDE.md §8 ("1-2 ticks")
 */

// ─── Public Types ───────────────────────────────────────────────────────────

/** A single round-trip trade parsed from TradingView Strategy Tester CSV. */
export interface TesterTrade {
  tradeNum: number;
  direction: "long" | "short";
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  /** From the CSV "Profit" column on exit row; null when column absent. */
  pnl: number | null;
}

/** A single round-trip trade from the broker/paper-fill side. */
export interface BrokerTrade {
  entryTime: Date;
  exitTime: Date;
  direction: "long" | "short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
}

/** One matched pair (tester ↔ broker). */
export interface MatchedPair {
  tester: TesterTrade;
  broker: BrokerTrade;
}

/** Output of matchTrades(). */
export interface MatchResult {
  matched: MatchedPair[];
  unmatchedTester: TesterTrade[];
  unmatchedBroker: BrokerTrade[];
}

/** Per-trade reconciliation delta. */
export interface TradeReconciliation {
  testerTradeNum: number;
  direction: "long" | "short";
  /**
   * Entry slip in ticks (positive = broker got worse entry than tester).
   * Long: broker_entry - tester_entry; Short: tester_entry - broker_entry.
   */
  entrySlipTicks: number;
  /**
   * Exit slip in ticks (positive = broker got worse exit than tester).
   * Long: tester_exit - broker_exit; Short: broker_exit - tester_exit.
   */
  exitSlipTicks: number;
  /** broker.pnl - tester.pnl  (positive = broker outperformed tester). */
  pnlDelta: number;
  /** True iff both entrySlipTicks and exitSlipTicks are within tolerance. */
  withinTolerance: boolean;
}

/** Aggregate reconciliation report. */
export interface ReconcileReport {
  matched_count: number;
  unmatched_tester: number;
  unmatched_broker: number;
  /** Largest absolute per-trade price delta in ticks (entry or exit). */
  max_abs_price_delta_ticks: number;
  /** Sum of (broker.pnl - tester.pnl) across all matched trades. */
  cum_pnl_delta: number;
  /**
   * True iff: no unmatched trades on either side AND every per-trade
   * entry/exit slip is within tolerance_ticks.
   */
  within_tolerance: boolean;
  per_trade: TradeReconciliation[];
}

export interface ReconcileOpts {
  tickSize: number;
  tickValue: number;
  /** Max ticks per leg to be considered in-tolerance. Default: 2. */
  tolerance_ticks?: number;
}

export interface MatchOpts {
  /** Max ms between tester and broker entry times. Default: 5 minutes. */
  windowMs?: number;
}

export interface TickSpec {
  tickSize: number;
  tickValue: number;
}

// ─── Tick Registry ──────────────────────────────────────────────────────────

const TICK_REGISTRY: Record<string, TickSpec> = {
  MES: { tickSize: 0.25, tickValue: 1.25 },
  MNQ: { tickSize: 0.25, tickValue: 0.50 },
  MCL: { tickSize: 0.01, tickValue: 1.00 },
  MGC: { tickSize: 0.10, tickValue: 1.00 },
  M2K: { tickSize: 0.10, tickValue: 0.50 },
  ES:  { tickSize: 0.25, tickValue: 12.50 },
  NQ:  { tickSize: 0.25, tickValue: 5.00 },
  CL:  { tickSize: 0.01, tickValue: 10.00 },
};

/**
 * Return tick spec for a symbol. Strips trailing expiry code (e.g. "MES1!" → "MES").
 * Falls back to MES spec when symbol is not registered.
 */
export function getTickSpec(symbol: string): TickSpec {
  // Extract leading alpha characters only: "MNQ2025M" → "MNQ", "MES1!" → "MES"
  const root = (symbol.match(/^[A-Za-z]+/)?.[0] ?? symbol).toUpperCase();
  return TICK_REGISTRY[root] ?? { tickSize: 0.25, tickValue: 1.25 };
}

// ─── CSV Date Parsing ────────────────────────────────────────────────────────

/**
 * Normalise a TradingView date string and parse to Date.
 *
 * Handles:
 *   "2024-01-15 09:30"              → treated as UTC (no-tz symmetry)
 *   "2024-01-15 09:30:00 -0500"     → respects offset
 *   "2024-01-15T09:30:00-05:00"     → standard ISO
 *   "2024-01-15T09:30:00Z"          → UTC ISO
 *
 * Throws if string cannot be parsed.
 */
function parseDateTimeStr(raw: string): Date {
  const s = raw.trim();

  // Already ISO with offset or Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([+-]\d{2}:\d{2}|Z)$/.test(s)) {
    return new Date(s);
  }

  // "YYYY-MM-DD HH:MM:SS +HHMM" or "YYYY-MM-DD HH:MM +HHMM"
  const withOffset = s.match(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+([+-]\d{4})$/
  );
  if (withOffset) {
    const [, date, time, off] = withOffset;
    const offsetColon = `${off.slice(0, 3)}:${off.slice(3)}`;
    const timeFull = time.length === 5 ? `${time}:00` : time;
    return new Date(`${date}T${timeFull}${offsetColon}`);
  }

  // "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS" — no timezone → UTC
  const noTz = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
  if (noTz) {
    const [, date, time] = noTz;
    const timeFull = time.length === 5 ? `${time}:00` : time;
    return new Date(`${date}T${timeFull}Z`);
  }

  // Last resort: engine's Date constructor
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    throw new Error(`pine-broker-reconcile: unparseable date "${raw}"`);
  }
  return d;
}

// ─── CSV Parser ──────────────────────────────────────────────────────────────

/** Split a single CSV line respecting double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let inQuote = false;
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

/** Normalise a header cell to an alphanumeric key for case-insensitive lookup. */
function headerKey(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Parse TradingView Strategy Tester "List of trades" CSV export.
 *
 * Handles both classic and 2025+ export shapes:
 *   Classic: Trade #, Type, Signal, Date/Time, Price, Contracts, Profit
 *   2025+:   Same core columns + Run-up, Drawdown, Cum. Profit, % Profit, etc.
 *
 * Unknown columns are tolerated. Each trade is represented as two rows
 * (entry + exit) identified by "Trade #". Incomplete pairs are skipped.
 *
 * Returns trades sorted ascending by entryTime.
 */
export function parseStrategyTesterCsv(csvText: string): TesterTrade[] {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim() !== "");

  if (lines.length === 0) return [];

  // Locate header row (first row containing a "trade" or "type" column)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cells = splitCsvLine(lines[i]);
    if (
      cells.some(
        (c) => /trade/i.test(c) || /^type$/i.test(c.trim())
      )
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      "pine-broker-reconcile: CSV header not found — expected Trade # and Type columns"
    );
  }

  const headers = splitCsvLine(lines[headerIdx]).map(headerKey);

  // Resolve column index by a list of candidate names (first match wins)
  function colIdx(candidates: string[]): number {
    for (const name of candidates) {
      const idx = headers.indexOf(headerKey(name));
      if (idx !== -1) return idx;
    }
    return -1;
  }

  const iTradeNum = colIdx(["Trade #", "Trade", "TradeNo", "Trade No"]);
  const iType     = colIdx(["Type"]);
  const iDateTime = colIdx(["Date/Time", "DateTime", "Date Time", "Date"]);
  const iPrice    = colIdx(["Price"]);
  const iContracts = colIdx(["Contracts", "Qty", "Quantity", "Size"]);
  const iProfit   = colIdx(["Profit", "PnL", "P&L", "Net Profit"]);

  if (iTradeNum === -1 || iType === -1 || iDateTime === -1 || iPrice === -1) {
    throw new Error(
      "pine-broker-reconcile: CSV missing required columns — need Trade #, Type, Date/Time, Price"
    );
  }

  // Accumulate entry/exit rows per trade number
  interface RawRow {
    time: Date;
    price: number;
    qty: number;
    typeLower: string;
    profit: number | null;
  }
  const tradeMap = new Map<number, { entry?: RawRow; exit?: RawRow }>();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < Math.max(iTradeNum, iType, iDateTime, iPrice) + 1) continue;

    const rawNum = (cells[iTradeNum] ?? "").trim();
    if (!rawNum || !/^\d+$/.test(rawNum)) continue;

    const tradeNum = parseInt(rawNum, 10);
    const typeLower = (cells[iType] ?? "").trim().toLowerCase();

    const rawPrice = (cells[iPrice] ?? "").replace(/,/g, "").trim();
    const price = parseFloat(rawPrice);
    if (isNaN(price)) continue; // summary rows may have dashes

    let time: Date;
    try {
      time = parseDateTimeStr(cells[iDateTime] ?? "");
    } catch {
      continue; // skip rows with unparseable timestamps
    }

    const rawContracts = iContracts >= 0 ? (cells[iContracts] ?? "").trim() : "";
    const qty = rawContracts ? Math.max(1, parseInt(rawContracts.replace(/,/g, ""), 10) || 1) : 1;

    const rawProfit =
      iProfit >= 0
        ? (cells[iProfit] ?? "").replace(/[$,%]/g, "").trim()
        : "";
    const profit =
      rawProfit !== "" && rawProfit !== "-" && rawProfit !== "—"
        ? parseFloat(rawProfit)
        : null;

    const isEntry = typeLower.includes("entry");
    const row: RawRow = { time, price, qty, typeLower, profit };

    if (!tradeMap.has(tradeNum)) tradeMap.set(tradeNum, {});
    const rec = tradeMap.get(tradeNum)!;
    if (isEntry) {
      rec.entry = row;
    } else {
      rec.exit = row;
    }
  }

  const trades: TesterTrade[] = [];
  for (const [tradeNum, rec] of tradeMap) {
    if (!rec.entry || !rec.exit) continue; // incomplete pair — skip

    const direction: "long" | "short" = rec.entry.typeLower.includes("long")
      ? "long"
      : "short";

    trades.push({
      tradeNum,
      direction,
      entryTime: rec.entry.time,
      exitTime: rec.exit.time,
      entryPrice: rec.entry.price,
      exitPrice: rec.exit.price,
      qty: rec.entry.qty,
      pnl: rec.exit.profit,
    });
  }

  return trades.sort((a, b) => a.entryTime.getTime() - b.entryTime.getTime());
}

// ─── Trade Matching ──────────────────────────────────────────────────────────

const DEFAULT_MATCH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Match tester trades to broker trades by:
 *   1. Direction must match (long/short)
 *   2. Entry time within windowMs (default 5 min)
 *   3. Among eligible broker trades, pick the closest entry time
 *
 * Each trade is consumed at most once. Sorts both sides chronologically
 * before matching. Returns unmatched lists for explicit surface.
 */
export function matchTrades(
  testerTrades: TesterTrade[],
  brokerTrades: BrokerTrade[],
  opts: MatchOpts = {}
): MatchResult {
  const windowMs = opts.windowMs ?? DEFAULT_MATCH_WINDOW_MS;

  if (testerTrades.length === 0 && brokerTrades.length === 0) {
    return { matched: [], unmatchedTester: [], unmatchedBroker: [] };
  }

  const sortedTester = [...testerTrades].sort(
    (a, b) => a.entryTime.getTime() - b.entryTime.getTime()
  );
  const sortedBroker = [...brokerTrades].sort(
    (a, b) => a.entryTime.getTime() - b.entryTime.getTime()
  );

  const matched: MatchedPair[] = [];
  const usedBroker = new Set<number>();

  for (const tester of sortedTester) {
    let bestIdx = -1;
    let bestDelta = Infinity;

    for (let bi = 0; bi < sortedBroker.length; bi++) {
      if (usedBroker.has(bi)) continue;
      const broker = sortedBroker[bi];
      if (broker.direction !== tester.direction) continue;
      const delta = Math.abs(
        broker.entryTime.getTime() - tester.entryTime.getTime()
      );
      if (delta <= windowMs && delta < bestDelta) {
        bestDelta = delta;
        bestIdx = bi;
      }
    }

    if (bestIdx !== -1) {
      usedBroker.add(bestIdx);
      matched.push({ tester, broker: sortedBroker[bestIdx] });
    }
  }

  const matchedTesters = new Set(matched.map((m) => m.tester));
  const unmatchedTester = sortedTester.filter((t) => !matchedTesters.has(t));
  const unmatchedBroker = sortedBroker.filter((_, i) => !usedBroker.has(i));

  return { matched, unmatchedTester, unmatchedBroker };
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

/**
 * Compute per-trade deltas and aggregate report.
 *
 * Slip convention (positive = broker fill was worse than tester):
 *   Long entry: broker_entry - tester_entry
 *   Long exit:  tester_exit  - broker_exit
 *   Short entry: tester_entry - broker_entry
 *   Short exit:  broker_exit  - tester_exit
 *
 * P&L delta = broker.pnl - tester.pnl
 *   If tester.pnl is null (column absent), it is estimated from prices.
 *
 * within_tolerance requires:
 *   - No unmatched trades on either side
 *   - Every per-trade entrySlipTicks and exitSlipTicks within tolerance_ticks
 */
export function reconcile(
  matchResult: MatchResult,
  opts: ReconcileOpts
): ReconcileReport {
  const { tickSize, tickValue } = opts;
  const toleranceTicks = opts.tolerance_ticks ?? 2;

  const perTrade: TradeReconciliation[] = [];
  let maxAbsPriceDeltaTicks = 0;
  let cumPnlDelta = 0;

  for (const { tester, broker } of matchResult.matched) {
    // Slip in ticks — round to 3 dp to suppress float noise
    let entrySlipTicks: number;
    let exitSlipTicks: number;

    if (tester.direction === "long") {
      entrySlipTicks = (broker.entryPrice - tester.entryPrice) / tickSize;
      exitSlipTicks  = (tester.exitPrice  - broker.exitPrice)  / tickSize;
    } else {
      entrySlipTicks = (tester.entryPrice - broker.entryPrice) / tickSize;
      exitSlipTicks  = (broker.exitPrice  - tester.exitPrice)  / tickSize;
    }

    entrySlipTicks = Math.round(entrySlipTicks * 1000) / 1000;
    exitSlipTicks  = Math.round(exitSlipTicks  * 1000) / 1000;

    // P&L delta
    const testerPnl =
      tester.pnl !== null
        ? tester.pnl
        : tester.direction === "long"
        ? ((tester.exitPrice - tester.entryPrice) / tickSize) * tickValue * tester.qty
        : ((tester.entryPrice - tester.exitPrice) / tickSize) * tickValue * tester.qty;

    const pnlDelta = Math.round((broker.pnl - testerPnl) * 100) / 100;

    // Track max absolute price delta (max of entry or exit, in ticks)
    const entryAbsTicks = Math.abs(entrySlipTicks);
    const exitAbsTicks  = Math.abs(exitSlipTicks);
    const maxThisTrade  = Math.max(entryAbsTicks, exitAbsTicks);
    if (maxThisTrade > maxAbsPriceDeltaTicks) {
      maxAbsPriceDeltaTicks = maxThisTrade;
    }

    cumPnlDelta += pnlDelta;

    const withinTolerance =
      entryAbsTicks <= toleranceTicks && exitAbsTicks <= toleranceTicks;

    perTrade.push({
      testerTradeNum: tester.tradeNum,
      direction: tester.direction,
      entrySlipTicks,
      exitSlipTicks,
      pnlDelta,
      withinTolerance,
    });
  }

  const within_tolerance =
    matchResult.unmatchedTester.length === 0 &&
    matchResult.unmatchedBroker.length === 0 &&
    perTrade.every((t) => t.withinTolerance);

  return {
    matched_count: matchResult.matched.length,
    unmatched_tester: matchResult.unmatchedTester.length,
    unmatched_broker: matchResult.unmatchedBroker.length,
    max_abs_price_delta_ticks: Math.round(maxAbsPriceDeltaTicks * 1000) / 1000,
    cum_pnl_delta: Math.round(cumPnlDelta * 100) / 100,
    within_tolerance,
    per_trade: perTrade,
  };
}
