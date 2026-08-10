//@version=1
// Slumdawg FX Replay — Yellow Structural Entry v0.1
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
//
// Purpose:
// - run on the 5-minute execution chart;
// - request 15-minute structure through FXR MTF;
// - identify confirmed 2-left / 2-right swing highs and lows;
// - remember the most recent N confirmed swings per side;
// - LONG yellow = highest recent confirmed swing-high wick;
// - SHORT yellow = lowest recent confirmed swing-low wick;
// - draw both as full horizontal yellow bands.
//
// This intentionally does NOT implement PDH/PDL/PWH/PWL in this file because
// FXR's documented MTF API permits one mtf.timeframe() request per indicator.
// D/W parity remains a separate platform lane rather than a silent approximation.

const TICK = 0.25;
const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;
const MAX_MTF_SCAN = 180;

init = () => {
  indicator({ onMainPanel: true, format: "inherit" });
  input.bool("Show Yellow Entries", true, "showentries");
  input.int("Swing Memory", 8, "swingmemory", 2, 20, 1);

  // Official FXR MTF guidance: call exactly once in init.
  mtf.timeframe("15");
};

const finite = (v) => typeof v === "number" && isFinite(v);

const pivotHighAt = (i) => {
  const h = mtf.high(i, false);
  const n1 = mtf.high(i - 1, false);
  const n2 = mtf.high(i - 2, false);
  const o1 = mtf.high(i + 1, false);
  const o2 = mtf.high(i + 2, false);
  if (![h, n1, n2, o1, o2].every(finite)) return false;
  return h > n1 && h > n2 && h > o1 && h > o2;
};

const pivotLowAt = (i) => {
  const l = mtf.low(i, false);
  const n1 = mtf.low(i - 1, false);
  const n2 = mtf.low(i - 2, false);
  const o1 = mtf.low(i + 1, false);
  const o2 = mtf.low(i + 2, false);
  if (![l, n1, n2, o1, o2].every(finite)) return false;
  return l < n1 && l < n2 && l < o1 && l < o2;
};

const roundLong = (p) => Math.ceil((p - 1e-10) / TICK) * TICK;
const roundShort = (p) => Math.floor((p + 1e-10) / TICK) * TICK;

const selectOuterPair = (length, memory) => {
  // On the intended 5m chart, one 15m bar spans about three host bars.
  // Keep the scan bounded and fail closed if history is too short.
  const available15m = Math.max(0, Math.floor(length / 3) - 3);
  const scanLimit = Math.min(MAX_MTF_SCAN, available15m);

  let highCount = 0;
  let lowCount = 0;
  let outerHigh = null;
  let outerLow = null;

  // i=2 is the newest pivot that can already have two newer confirmation bars.
  for (
    let i = 2;
    i <= scanLimit && (highCount < memory || lowCount < memory);
    i++
  ) {
    if (highCount < memory && pivotHighAt(i)) {
      const h = mtf.high(i, false);
      outerHigh = outerHigh === null ? h : Math.max(outerHigh, h);
      highCount += 1;
    }

    if (lowCount < memory && pivotLowAt(i)) {
      const l = mtf.low(i, false);
      outerLow = outerLow === null ? l : Math.min(outerLow, l);
      lowCount += 1;
    }
  }

  return {
    longEntry: outerHigh === null ? null : roundLong(outerHigh),
    shortEntry: outerLow === null ? null : roundShort(outerLow),
    highCount,
    lowCount,
  };
};

onTick = (length, _moment, _, ta, inputs) => {
  if (!inputs.showentries) return;
  if (length < 30) return;

  const memory = Math.max(2, Math.min(20, inputs.swingmemory));
  const pair = selectOuterPair(length, memory);

  if (pair.longEntry !== null && finite(pair.longEntry)) {
    band.line("LONG ENTRY", pair.longEntry, "#FFBE19", 0, 3, true);
  }

  if (pair.shortEntry !== null && finite(pair.shortEntry)) {
    band.line("SHORT ENTRY", pair.shortEntry, "#FFBE19", 0, 3, true);
  }
};
