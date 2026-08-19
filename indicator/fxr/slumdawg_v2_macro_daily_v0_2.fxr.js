//@version=1
// Slumdawg FX Replay V2.0.2 — Daily Macro BIG DIRECTION
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
//
// This helper is the macro-direction authority in the FXR V2 bundle. A strong
// lower-timeframe rally does not flip the macro state while Daily structure is
// still lower-high/lower-low. Run beside the 15m Entry/TP adapter.

const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;
const MAX_SCAN = 120;
let bigDirection = 0;
let protectedLevel = null;

init = () => {
  indicator({ onMainPanel: true, format: "inherit" });
  input.bool("Show Macro Protected Level", true, "showmacro");
  mtf.timeframe("D");
};

const finite = (v) => typeof v === "number" && isFinite(v);
const pivotHigh = (i) => {
  const h = mtf.high(i, false);
  const rows = [mtf.high(i - 1, false), mtf.high(i - 2, false), mtf.high(i + 1, false), mtf.high(i + 2, false)];
  return finite(h) && rows.every(finite) && h > rows[0] && h > rows[1] && h > rows[2] && h > rows[3];
};
const pivotLow = (i) => {
  const l = mtf.low(i, false);
  const rows = [mtf.low(i - 1, false), mtf.low(i - 2, false), mtf.low(i + 1, false), mtf.low(i + 2, false)];
  return finite(l) && rows.every(finite) && l < rows[0] && l < rows[1] && l < rows[2] && l < rows[3];
};

const latest = () => {
  const highs = [], lows = [];
  for (let i = 2; i <= MAX_SCAN && (highs.length < 2 || lows.length < 2); i++) {
    if (highs.length < 2 && pivotHigh(i)) highs.push(mtf.high(i, false));
    if (lows.length < 2 && pivotLow(i)) lows.push(mtf.low(i, false));
  }
  return { highs, lows };
};

const clearDirection = (p) => {
  if (p.highs.length < 2 || p.lows.length < 2) return 0;
  if (p.highs[0] > p.highs[1] && p.lows[0] > p.lows[1]) return 1;
  if (p.highs[0] < p.highs[1] && p.lows[0] < p.lows[1]) return -1;
  return 0;
};

onTick = (length, _moment, _, ta, inputs) => {
  if (length < 40) return;
  const p = latest();
  const local = clearDirection(p);
  const c = mtf.closeC(0, false);

  if (bigDirection === 0 && local !== 0) {
    bigDirection = local;
    protectedLevel = local === 1 ? p.lows[0] : p.highs[0];
  } else if (bigDirection === -1) {
    if (local === -1) protectedLevel = p.highs[0];
    else if (local === 1 && finite(protectedLevel) && finite(c) && c > protectedLevel) {
      bigDirection = 1;
      protectedLevel = p.lows[0];
    }
  } else if (bigDirection === 1) {
    if (local === 1) protectedLevel = p.lows[0];
    else if (local === -1 && finite(protectedLevel) && finite(c) && c < protectedLevel) {
      bigDirection = -1;
      protectedLevel = p.highs[0];
    }
  }

  if (inputs.showmacro && finite(protectedLevel)) {
    const name = bigDirection === -1 ? "📉 BIG DIRECTION DOWN — DAILY MACRO" : "📈 BIG DIRECTION UP — DAILY MACRO";
    const clr = bigDirection === -1 ? "#E63746" : "#00CD69";
    band.line(name, protectedLevel, clr, 2, 2, true);
  }
};
