/**
 * spec-timeframe-recovery.test.ts — Timeframe Integrity Fix (2026-07-03)
 *
 * PURE recovery parser. Covers every TF token form, exec-vs-higher
 * disambiguation, the VWAP-anchor false-positive guard, and the INVIOLABLE
 * principle: an ambiguous spec returns recovered:false with exec_timeframe=null
 * — NEVER a silent "5m".
 */
import { describe, it, expect } from "vitest";
import {
  recoverSpecTimeframe,
  extractTimeframeMinutes,
} from "../spec-timeframe-recovery.js";

function spec(conditions: Array<Record<string, unknown>>, entryTriggerId: string) {
  return { spec: { entry_conditions: conditions, entry_trigger_id: entryTriggerId } };
}
function cond(id: string, object: string, role: string, type = "FILTER") {
  return { id, object, role, type };
}

describe("extractTimeframeMinutes — token forms (RAW; supported + unsupported)", () => {
  it("compact tokens: 5m, 15m, 1h, 4h, 1d", () => {
    expect(extractTimeframeMinutes("5m entry")).toEqual([5]);
    expect(extractTimeframeMinutes("trade the 15m chart")).toEqual([15]);
    expect(extractTimeframeMinutes("1h bias")).toEqual([60]);
    expect(extractTimeframeMinutes("4h structure")).toEqual([240]);
    expect(extractTimeframeMinutes("1d level")).toEqual([1440]);
  });

  it("phrase forms: N minute / N hour / N-minute", () => {
    expect(extractTimeframeMinutes("15 minute support level")).toEqual([15]);
    expect(extractTimeframeMinutes("4 hour time frame")).toEqual([240]);
    expect(extractTimeframeMinutes("30-minute chart")).toEqual([30]);
  });

  it("emits RAW unsupported minute values too (filtered later at assignment)", () => {
    expect(extractTimeframeMinutes("6 minute candle open")).toEqual([6]);
    expect(extractTimeframeMinutes("50 minute time frame")).toEqual([50]);
    expect(extractTimeframeMinutes("2 hr window")).toEqual([120]);
  });

  it("compact + word both present resolve to one value (5m minute support level → 5m)", () => {
    expect(extractTimeframeMinutes("5m minute support level")).toEqual([5]);
  });

  it("word-form periods ONLY count in a chart context", () => {
    expect(extractTimeframeMinutes("daily chart")).toEqual([1440]);
    expect(extractTimeframeMinutes("hourly candle")).toEqual([60]);
    expect(extractTimeframeMinutes("weekly time frame")).toEqual([10080]); // raw; unsupported → dropped at assignment
  });

  it("VWAP/anchor false-positive guard: bare daily/weekly/monthly NOT a chart TF", () => {
    expect(extractTimeframeMinutes("daily vwap")).toEqual([]);
    expect(extractTimeframeMinutes("weekly high")).toEqual([]);
    expect(extractTimeframeMinutes("monthly vwap")).toEqual([]);
    expect(extractTimeframeMinutes("daily buy signal")).toEqual([]);
  });

  it("number-vs-timeframe: a bare number with NO time unit is NOT a TF (structurally excluded)", () => {
    expect(extractTimeframeMinutes("50 ema")).toEqual([]);
    expect(extractTimeframeMinutes("200 sma cross")).toEqual([]);
    expect(extractTimeframeMinutes("6 candles")).toEqual([]);
    expect(extractTimeframeMinutes("20 period rsi")).toEqual([]);
    expect(extractTimeframeMinutes("10 ticks")).toEqual([]);
    expect(extractTimeframeMinutes("50 point stop")).toEqual([]);
  });

  it("no token → empty", () => {
    expect(extractTimeframeMinutes("mean reversion trigger")).toEqual([]);
    expect(extractTimeframeMinutes("higher time frame vwap stack")).toEqual([]);
    expect(extractTimeframeMinutes("")).toEqual([]);
  });

  it("F-3 spelled-out numbers: 'five minute' / 'four hour' / 'one day'", () => {
    expect(extractTimeframeMinutes("five minute time frame")).toEqual([5]);
    expect(extractTimeframeMinutes("four hour chart")).toEqual([240]);
    expect(extractTimeframeMinutes("one day time frame")).toEqual([1440]);
  });

  it("F-3 concatenated (transcript-normalization artifact): 'fiveminute' / 'onehour' / 'fourhour'", () => {
    expect(extractTimeframeMinutes("fiveminute time frame")).toEqual([5]);
    expect(extractTimeframeMinutes("onehour setup")).toEqual([60]);
    expect(extractTimeframeMinutes("fourhour bias")).toEqual([240]);
  });

  it("F-3 letter-first ICT/chart shorthand: m1 / m5 / m15 / m30 / h1 / h4 / d1", () => {
    expect(extractTimeframeMinutes("m1 timeframe is not noise")).toEqual([1]);
    expect(extractTimeframeMinutes("m5 entry")).toEqual([5]);
    expect(extractTimeframeMinutes("m15 chart")).toEqual([15]);
    expect(extractTimeframeMinutes("h4 chart")).toEqual([240]);
    expect(extractTimeframeMinutes("d1 bias")).toEqual([1440]);
  });

  it("F-2b 'N hourly' keeps its multiplier; bare 'hourly' → 1h", () => {
    expect(extractTimeframeMinutes("previous 4 hourly candle close")).toEqual([240]);
    expect(extractTimeframeMinutes("current hourly candle alignment chart")).toEqual([60]);
    expect(extractTimeframeMinutes("2 hourly bar")).toEqual([120]);
  });

  it("F-2 indicator/lookback guard: '200 ma daily' / '20 day high' NOT emitted as a TF", () => {
    expect(extractTimeframeMinutes("200 ma daily time frame")).toEqual([]);
    expect(extractTimeframeMinutes("50 ema hourly")).toEqual([]);
    expect(extractTimeframeMinutes("20 day high")).toEqual([]);
    expect(extractTimeframeMinutes("200 day moving average")).toEqual([]);
  });

  it("F-2 clock-time guard: 'HH MM m eastern' (a 9:30 session time) is NOT a chart TF", () => {
    expect(extractTimeframeMinutes("9 30 m eastern standard time")).toEqual([]);
    expect(extractTimeframeMinutes("9 45 m eastern")).toEqual([]);
    expect(extractTimeframeMinutes("10 00 m eastern")).toEqual([]);
    // but a real bare-m chart TF still parses:
    expect(extractTimeframeMinutes("15 m chart")).toEqual([15]);
    expect(extractTimeframeMinutes("5m")).toEqual([5]);
    expect(extractTimeframeMinutes("15 minute")).toEqual([15]);
  });
});

describe("recoverSpecTimeframe — exec vs higher disambiguation", () => {
  it("exec from the entry-trigger condition; higher = highest context frame (0.9 conf)", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "5m minute support level", "trigger", "ENABLE_ENTRY"),
          cond("C1", "30 minute time frame", "confluence", "WAIT_SESSION"),
          cond("C2", "4 hour time frame", "confluence", "WAIT_SESSION"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("5m");
    expect(r.higher_timeframe).toBe("4h");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("exec = lowest execution-grade TF across roles; higher = highest context frame", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "mean reversion", "trigger", "ENABLE_ENTRY"),
          cond("S1", "15 minute entry structure", "spine", "WAIT_STRUCTURE"),
          cond("C2", "4 hour time frame", "confluence", "WAIT_SESSION"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("15m");
    expect(r.higher_timeframe).toBe("4h");
    // 15m came from a spine WAIT_STRUCTURE (execution-grade), not the trigger.
    expect(r.confidence).toBeCloseTo(0.6, 5);
  });

  it("single stated TF → exec = that TF, higher = null", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "reversal on the 4 hour time frame", "trigger", "ENABLE_ENTRY")], "T1"),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("4h");
    expect(r.higher_timeframe).toBeNull();
  });
});

describe("recoverSpecTimeframe — INVIOLABLE: ambiguous NEVER defaults to 5m", () => {
  it("VWAP-only spec (all daily/weekly/monthly anchors) → recovered:false, exec null", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "mean reversion", "trigger", "ENABLE_ENTRY"),
          cond("C1", "daily vwap", "confluence", "WAIT_STRUCTURE"),
          cond("C2", "weekly vwap", "confluence", "WAIT_STRUCTURE"),
          cond("C3", "monthly vwap", "confluence", "WAIT_STRUCTURE"),
          cond("S1", "higher time frame vwap stack", "spine", "WAIT_BIAS"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
    expect(r.exec_timeframe).not.toBe("5m");
    expect(r.higher_timeframe).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("bare 'timeframe' word with no number → recovered:false (not 5m)", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "timeframe selection", "trigger", "ENABLE_ENTRY")], "T1"),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
    expect(r.exec_timeframe).not.toBe("5m");
  });

  it("empty / malformed artifact → recovered:false, never throws", () => {
    expect(recoverSpecTimeframe(null).recovered).toBe(false);
    expect(recoverSpecTimeframe({}).recovered).toBe(false);
    expect(recoverSpecTimeframe({ spec: { entry_conditions: [] } }).recovered).toBe(false);
    expect(recoverSpecTimeframe(null).exec_timeframe).toBeNull();
  });
});

describe("recoverSpecTimeframe — supported-set constraint (engine-backtestable only)", () => {
  it("exec 6m (unsupported) → QUARANTINE, never snapped, never 5m", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "reversal candle at 6 m", "trigger", "ENABLE_ENTRY")], "T1"),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
    expect(r.evidence).toMatch(/not engine-backtestable/i);
  });

  it("exec 50m (unsupported) → QUARANTINE", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "entry on the 50 minute time frame", "trigger", "ENABLE_ENTRY")], "T1"),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
  });

  it("exec 1w (weekly, unsupported) → QUARANTINE", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "weekly time frame entry", "trigger", "ENABLE_ENTRY")], "T1"),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
  });

  it("HTF-promotion guard: unsupported exec (6m) + supported context (4h) → QUARANTINE, NOT exec=4h", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "reversal candle at 6 m", "trigger", "ENABLE_ENTRY"),
          cond("C1", "4 hour time frame bias", "confluence"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).not.toBe("4h");
    expect(r.exec_timeframe).toBeNull();
  });

  it("supported exec (5m) + unsupported higher (1w) → recover 5m, higher dropped to null", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "5m entry trigger", "trigger", "ENABLE_ENTRY"),
          cond("C1", "weekly time frame context", "confluence"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("5m");
    expect(r.higher_timeframe).toBeNull();
  });

  it("supported exec + supported higher still recover (15m/1h/4h stay)", () => {
    expect(recoverSpecTimeframe(spec([cond("T1", "15 minute entry", "trigger", "ENABLE_ENTRY")], "T1")).exec_timeframe).toBe("15m");
    expect(recoverSpecTimeframe(spec([cond("T1", "1 hour entry", "trigger", "ENABLE_ENTRY")], "T1")).exec_timeframe).toBe("1h");
    expect(recoverSpecTimeframe(spec([cond("T1", "4 hour entry", "trigger", "ENABLE_ENTRY")], "T1")).exec_timeframe).toBe("4h");
  });

  it("'50 EMA' / '6 candles' as the only tokens → recovered:false (no TF at all)", () => {
    expect(recoverSpecTimeframe(spec([cond("T1", "50 ema cross", "trigger", "ENABLE_ENTRY")], "T1")).recovered).toBe(false);
    expect(recoverSpecTimeframe(spec([cond("T1", "6 candles of momentum", "trigger", "ENABLE_ENTRY")], "T1")).recovered).toBe(false);
  });
});

describe("recoverSpecTimeframe — F-1 exec-vs-bias by CONDITION TYPE (not role)", () => {
  it("a WAIT_BIAS:daily tagged role=spine is NOT promoted to exec; intraday exec wins (manipulation_trade class)", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "manipulation trade", "trigger", "ENABLE_ENTRY"),
          cond("C1", "m1 timeframe is not noise", "confluence", "WAIT_SESSION"), // 1m exec
          cond("S1", "daily time frame", "spine", "WAIT_SESSION"), // daily → bias, NOT exec
          cond("C2", "price action relative to 15m candle structure", "confluence", "WAIT_STRUCTURE"), // 15m exec
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("1m"); // NOT 1d
    expect(r.exec_timeframe).not.toBe("1d");
    expect(r.higher_timeframe).toBe("1d"); // daily is the higher context
  });

  it("intraday WAIT_SESSION exec is recovered even when only in confluence roles (buying_opportunity class)", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "buying opportunity", "trigger", "ENABLE_ENTRY"),
          cond("C1", "15 minute time frame", "confluence", "WAIT_SESSION"), // 15m exec
          cond("C2", "4 hour candle structure", "confluence", "WAIT_SESSION"), // 4h exec
          cond("S1", "daily bias", "spine", "WAIT_BIAS"), // WAIT_BIAS → bias only (no chart-ctx anyway)
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("15m");
  });

  it("WAIT_BIAS-daily-only spec (all context via WAIT_SESSION daily) → QUARANTINE", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "price break", "trigger", "ENABLE_ENTRY"),
          cond("C1", "monthly time frame analysis", "confluence", "WAIT_SESSION"),
          cond("C2", "daily time frame analysis", "confluence", "WAIT_SESSION"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
  });
});

describe("recoverSpecTimeframe — F-1 provenance-tier exec selection + ≥1d-never-exec", () => {
  it("a role=trigger 5m beats a smaller spine 1m NOISE token (entry_chart_timeframe class)", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          // exact entry-trigger names no TF...
          cond("T0", "entry chart timeframe", "trigger", "WAIT_SESSION"),
          // ...a role=trigger filter names the real 5m entry...
          cond("T1", "5 minute entry filter", "trigger", "FILTER"),
          // ...and a spine "1 minute" is a passing comparison, NOT the exec.
          cond("S1", "just like with 1 minute i get triggered quickly", "spine", "WAIT_SESSION"),
          cond("C1", "current 4 hour candle bias", "confluence", "WAIT_BIAS"),
        ],
        "T0",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("5m"); // NOT 1m
    expect(r.exec_timeframe).not.toBe("1m");
    expect(r.higher_timeframe).toBe("4h");
    expect(r.confidence).toBeCloseTo(0.8, 5);
  });

  it("F-2a: a WAIT_STRUCTURE 'daily chart' is NEVER exec — 1d → higher_timeframe, intraday exec wins", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "5 minute entry", "trigger", "ENABLE_ENTRY"),
          cond("S1", "major structure level daily chart", "spine", "WAIT_STRUCTURE"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("5m");
    expect(r.higher_timeframe).toBe("1d"); // the WAIT_STRUCTURE daily is higher context, not exec
  });

  it("F-2a: a spec whose ONLY execution-grade TF would be a WAIT_STRUCTURE 'daily chart' → QUARANTINE (no intraday exec)", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "reclaim major structure level daily chart", "trigger", "WAIT_STRUCTURE")], "T1"),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
  });
});

describe("recoverSpecTimeframe — F-3 spelled/shorthand exec wins via raw-space Math.min pin", () => {
  it("spine 'five minute' beats a 1h context (retracement_opportunity/trading_session_time class)", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "retracement entry", "trigger", "ENABLE_ENTRY"),
          cond("S1", "five minute execution structure", "spine", "WAIT_STRUCTURE"),
          cond("C1", "1 hour bias", "confluence", "WAIT_BIAS"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("5m");
    expect(r.higher_timeframe).toBe("1h");
  });

  it("concatenated 'fiveminute' on the trigger recovers 5m", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "entry on fiveminute close", "trigger", "ENABLE_ENTRY")], "T1"),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("5m");
  });
});

describe("recoverSpecTimeframe — F-4 role-provenance floor (pure HTF-bias → quarantine)", () => {
  it("only monthly/daily bias in CONFLUENCE roles → QUARANTINE, never promoted to exec (price_break class)", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "price break above high", "trigger", "ENABLE_ENTRY"),
          cond("C1", "daily time frame top-down bias", "confluence", "WAIT_BIAS"),
          cond("C2", "monthly time frame context", "confluence", "WAIT_BIAS"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
    expect(r.evidence).toMatch(/higher-timeframe\/analysis context/i);
  });

  it("only HIGHER-TF (4h/1d/monthly) bias in CONFLUENCE roles → QUARANTINE (top-down analysis, no exec)", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "discount price to buy from", "trigger", "ENABLE_ENTRY"),
          cond("C2", "4 hour time frame bias", "confluence", "WAIT_BIAS"),
          cond("C3", "daily time frame context", "confluence", "WAIT_BIAS"),
          cond("C4", "monthly time frame context", "confluence", "WAIT_BIAS"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
  });

  it("ANTI-OVER-QUARANTINE: an explicit LOW execution TF ('5 minute chart') in a confluence role is READ, not discarded", () => {
    const r = recoverSpecTimeframe(
      spec(
        [
          cond("T1", "new high acceptance", "trigger", "ENABLE_ENTRY"),
          cond("C1", "5 minute chart", "confluence", "FILTER"),
        ],
        "T1",
      ),
    );
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("5m");
    expect(r.confidence).toBeCloseTo(0.4, 5);
  });

  it("'200 ma daily time frame' as the ONLY token → recovered:false (indicator, not a 1d exec)", () => {
    const r = recoverSpecTimeframe(
      spec([cond("T1", "enter when price reclaims 200 ma daily time frame", "trigger", "ENABLE_ENTRY")], "T1"),
    );
    expect(r.recovered).toBe(false);
    expect(r.exec_timeframe).toBeNull();
    expect(r.exec_timeframe).not.toBe("1d");
  });
});

describe("recoverSpecTimeframe — accepts full artifact or bare body", () => {
  it("recovers when passed a bare spec body (no .spec wrapper)", () => {
    const r = recoverSpecTimeframe({
      entry_conditions: [cond("T1", "15m entry", "trigger", "ENABLE_ENTRY")],
      entry_trigger_id: "T1",
    });
    expect(r.recovered).toBe(true);
    expect(r.exec_timeframe).toBe("15m");
  });
});
