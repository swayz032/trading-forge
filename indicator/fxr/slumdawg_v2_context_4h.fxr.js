//@version=1
// Slumdawg FX Replay V2 — 4H Persistent Context Helper
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
//
// FXR currently documents one mtf.timeframe() request per indicator. This helper
// owns the 4H protected-structure component of BIG DIRECTION. It intentionally
// does NOT fake Daily confirmation or claim full TradingView BIG-DIRECTION parity.

const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;
const MAX_SCAN = 180;
let bigDirection = 0;
let protectedLevel = null;

init = () => {
  indicator({ onMainPanel: true, format: "inherit" });
  input.bool("Show Protected Structure", true, "showprotected");
  mtf.timeframe("240");
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

const latestPivots = () => {
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
  const p = latestPivots();
  const local = clearDirection(p);
  const c = mtf.closeC(0, false);

  if (bigDirection === 0 && local !== 0) {
    bigDirection = local;
    protectedLevel = local === 1 ? p.lows[0] : p.highs[0];
  } else if (bigDirection === -1) {
    if (local === -1) protectedLevel = p.highs[0];
    else if (finite(protectedLevel) && finite(c) && c > protectedLevel && local === 1) {
      bigDirection = 1;
      protectedLevel = p.lows[0];
    }
  } else if (bigDirection === 1) {
    if (local === 1) protectedLevel = p.lows[0];
    else if (finite(protectedLevel) && finite(c) && c < protectedLevel && local === -1) {
      bigDirection = -1;
      protectedLevel = p.highs[0];
    }
  }

  if (inputs.showprotected && finite(protectedLevel)) {
    const name = bigDirection === -1 ? "📉 BIG DIRECTION DOWN — PROTECTED HIGH" : "📈 BIG DIRECTION UP — PROTECTED LOW";
    const clr = bigDirection === -1 ? "#E63746" : "#00CD69";
    band.line(name, protectedLevel, clr, 2, 2, true);
  }
};
