//@version=1
// Slumdawg FX Replay V2 — 15m Current Move + Entry + TP + Candle Quality
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
//
// Run on a 5-minute MNQ/NQ chart.
// This adapter makes the single documented FXR MTF request to 15m. It therefore
// owns CURRENT MOVE, Entry Zones, 15m+5m TP shelves, and 5m candle/momentum state.
// BIG DIRECTION is intentionally NOT reinvented here; use the V2 4H context helper.

const TICK = 0.25;
const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;
const MAX_MTF_SCAN = 220;
const MAX_5M_SCAN = 360;

let currentMove = 0;
let entryStage = "WAIT_PROOF";
let armedSide = 0;
let armedProof = null;
let referencePrice = null;
let referenceLength = null;
let momentumAnchor = null;
let lastLength = 0;

init = () => {
  indicator({ onMainPanel: true, format: "inherit" });
  input.bool("Show Entry Zones", true, "showentries");
  input.bool("Show Take Profit Zones", true, "showtps");
  input.int("Swing Memory", 8, "swingmemory", 2, 20, 1);
  input.int("15m TP Minimum Reactions", 2, "mintouches15", 2, 4, 1);
  input.int("5m TP Minimum Reactions", 3, "mintouches5", 2, 6, 1);
  input.float("TP Penetration", 0.25, "tppenetration", 0.05, 0.45, 0.05);
  input.float("TP Cluster Tolerance x 15m ATR", 0.25, "tptolerance", 0.05, 0.75, 0.05);
  input.float("TP Entry Separation x 15m ATR", 0.35, "tpentrygap", 0.10, 1.50, 0.05);
  input.float("TP-to-TP Separation x 15m ATR", 0.15, "tpzonegap", 0.05, 0.75, 0.05);
  input.float("Strong Engulf Body Fraction", 0.60, "strongbody", 0.30, 0.90, 0.05);
  input.float("Strong Engulf Range x 5m ATR", 0.80, "strongrange", 0.30, 2.00, 0.05);
  mtf.timeframe("15");
};

const finite = (v) => typeof v === "number" && isFinite(v);
const roundLong = (p) => Math.ceil((p - 1e-10) / TICK) * TICK;
const roundShort = (p) => Math.floor((p + 1e-10) / TICK) * TICK;
const roundLongTarget = (p) => Math.floor((p + 1e-10) / TICK) * TICK;
const roundShortTarget = (p) => Math.ceil((p - 1e-10) / TICK) * TICK;

const pivotHigh15 = (i) => {
  const h = mtf.high(i, false);
  const rows = [mtf.high(i - 1, false), mtf.high(i - 2, false), mtf.high(i + 1, false), mtf.high(i + 2, false)];
  return finite(h) && rows.every(finite) && h > rows[0] && h > rows[1] && h > rows[2] && h > rows[3];
};
const pivotLow15 = (i) => {
  const l = mtf.low(i, false);
  const rows = [mtf.low(i - 1, false), mtf.low(i - 2, false), mtf.low(i + 1, false), mtf.low(i + 2, false)];
  return finite(l) && rows.every(finite) && l < rows[0] && l < rows[1] && l < rows[2] && l < rows[3];
};
const pivotHigh5 = (i) => finite(high(i)) && high(i) > high(i - 1) && high(i) > high(i - 2) && high(i) > high(i + 1) && high(i) > high(i + 2);
const pivotLow5 = (i) => finite(low(i)) && low(i) < low(i - 1) && low(i) < low(i - 2) && low(i) < low(i + 1) && low(i) < low(i + 2);

const collectPivots15 = (memory) => {
  let highs = [];
  let lows = [];
  for (let i = 2; i <= MAX_MTF_SCAN && (highs.length < memory || lows.length < memory); i++) {
    if (highs.length < memory && pivotHigh15(i)) highs.push({ price: mtf.high(i, false), index: i });
    if (lows.length < memory && pivotLow15(i)) lows.push({ price: mtf.low(i, false), index: i });
  }
  return { highs, lows };
};

const selectOuterPair = (memory) => {
  const pivots = collectPivots15(memory);
  const outerHigh = pivots.highs.length ? Math.max(...pivots.highs.map((x) => x.price)) : null;
  const outerLow = pivots.lows.length ? Math.min(...pivots.lows.map((x) => x.price)) : null;
  return {
    longEntry: outerHigh === null ? null : roundLong(outerHigh),
    shortEntry: outerLow === null ? null : roundShort(outerLow),
    pivots,
  };
};

const clear15Direction = (pivots) => {
  if (pivots.highs.length < 2 || pivots.lows.length < 2) return 0;
  const h0 = pivots.highs[0].price, h1 = pivots.highs[1].price;
  const l0 = pivots.lows[0].price, l1 = pivots.lows[1].price;
  if (h0 > h1 && l0 > l1) return 1;
  if (h0 < h1 && l0 < l1) return -1;
  return 0;
};

const updateCurrentMove = (pivots) => {
  if (!pivots.highs.length || !pivots.lows.length) return currentMove;
  const structural = clear15Direction(pivots);
  const c = mtf.closeC(0, false);
  const h0 = pivots.highs[0].price;
  const l0 = pivots.lows[0].price;
  if (currentMove === 0) {
    if (structural !== 0) currentMove = structural;
    else if (finite(c) && c > h0) currentMove = 1;
    else if (finite(c) && c < l0) currentMove = -1;
  } else if (currentMove === -1) {
    if (finite(c) && c > h0) currentMove = 1;
  } else if (finite(c) && c < l0) {
    currentMove = -1;
  }
  return currentMove;
};

const interval15 = (i, kind) => {
  if (kind === "LOW") {
    const lo = mtf.low(i, false), hi = Math.min(mtf.openC(i, false), mtf.closeC(i, false));
    return finite(lo) && finite(hi) && hi > lo ? { lo, hi } : null;
  }
  const lo = Math.max(mtf.openC(i, false), mtf.closeC(i, false)), hi = mtf.high(i, false);
  return finite(lo) && finite(hi) && hi > lo ? { lo, hi } : null;
};
const interval5 = (i, kind) => {
  if (kind === "LOW") {
    const lo = low(i), hi = Math.min(openC(i), closeC(i));
    return finite(lo) && finite(hi) && hi > lo ? { lo, hi } : null;
  }
  const lo = Math.max(openC(i), closeC(i)), hi = high(i);
  return finite(lo) && finite(hi) && hi > lo ? { lo, hi } : null;
};

const collectReactionIntervals = (lane, scan) => {
  const rows = [];
  for (let i = 3; i <= scan; i++) {
    if (lane === "15") {
      if (pivotLow15(i)) { const z = interval15(i, "LOW"); if (z) rows.push(z); }
      if (pivotHigh15(i)) { const z = interval15(i, "HIGH"); if (z) rows.push(z); }
    } else {
      if (pivotLow5(i)) { const z = interval5(i, "LOW"); if (z) rows.push(z); }
      if (pivotHigh5(i)) { const z = interval5(i, "HIGH"); if (z) rows.push(z); }
    }
    if (rows.length >= 48) break;
  }
  return rows;
};

const clusterAt = (rows, seedIndex, side, tolerance) => {
  const seed = rows[seedIndex];
  const edge = side === "LONG" ? seed.lo : seed.hi;
  let lo = Infinity, hi = -Infinity, touches = 0;
  for (const row of rows) {
    const e = side === "LONG" ? row.lo : row.hi;
    if (Math.abs(e - edge) <= tolerance) {
      touches += 1;
      lo = Math.min(lo, row.lo);
      hi = Math.max(hi, row.hi);
    }
  }
  return touches ? { lo, hi, touches } : null;
};

const pickCluster = (rows, side, boundary, gap, tolerance, minTouches) => {
  let best = null, bestDist = Infinity;
  for (let i = 0; i < rows.length; i++) {
    const c = clusterAt(rows, i, side, tolerance);
    if (!c || c.touches < minTouches) continue;
    const separated = side === "LONG" ? c.lo >= boundary + gap : c.hi <= boundary - gap;
    if (!separated) continue;
    const dist = side === "LONG" ? c.lo - boundary : boundary - c.hi;
    if (dist < bestDist) { best = c; bestDist = dist; }
  }
  return best;
};

const ladderFromRows = (rows, side, entry, entryGap, zoneGap, tolerance, minTouches, penetration) => {
  const out = [];
  let boundary = entry, gap = entryGap;
  for (let n = 0; n < 3; n++) {
    const c = pickCluster(rows, side, boundary, gap, tolerance, minTouches);
    if (!c) break;
    const raw = side === "LONG" ? c.lo + (c.hi - c.lo) * penetration : c.hi - (c.hi - c.lo) * penetration;
    out.push(side === "LONG" ? roundLongTarget(raw) : roundShortTarget(raw));
    boundary = side === "LONG" ? c.hi : c.lo;
    gap = zoneGap;
  }
  return out;
};

const mergeLadders = (side, entry, gap, zoneGap, lists) => {
  const rows = lists.flat().filter(finite);
  const out = [];
  let boundary = entry, needed = gap;
  for (let n = 0; n < 3; n++) {
    let best = null;
    for (const p of rows) {
      const ok = side === "LONG" ? p >= boundary + needed : p <= boundary - needed;
      if (!ok) continue;
      if (best === null || (side === "LONG" ? p < best : p > best)) best = p;
    }
    if (best === null) break;
    out.push(best);
    boundary = best;
    needed = zoneGap;
  }
  return out;
};

const bodyFraction = (i) => {
  const r = high(i) - low(i);
  return r > 0 ? Math.abs(closeC(i) - openC(i)) / r : 0;
};
const closeLocation = (i) => {
  const r = high(i) - low(i);
  return r > 0 ? (closeC(i) - low(i)) / r : 0.5;
};
const upperWickFraction = (i) => {
  const r = high(i) - low(i);
  return r > 0 ? (high(i) - Math.max(openC(i), closeC(i))) / r : 0;
};
const lowerWickFraction = (i) => {
  const r = high(i) - low(i);
  return r > 0 ? (Math.min(openC(i), closeC(i)) - low(i)) / r : 0;
};

const updateEntryState = (length, side, proof, atr5) => {
  const newBar = length > lastLength;
  if (lastLength === 0) lastLength = length;

  if (armedSide !== 0 && (armedSide !== side || !finite(proof) || Math.abs(proof - armedProof) >= TICK)) {
    entryStage = "WAIT_PROOF";
    armedSide = 0;
    armedProof = null;
    referencePrice = null;
    referenceLength = null;
    momentumAnchor = null;
  }

  if (newBar) {
    if (entryStage === "WAIT_PROOF" && finite(proof)) {
      const crossed = side === 1 ? closeC(1) > proof : closeC(1) < proof;
      if (crossed && bodyFraction(1) >= 0.15) {
        armedSide = side;
        armedProof = proof;
        referencePrice = side === 1 ? high(1) : low(1);
        referenceLength = length;
        momentumAnchor = referencePrice;
        entryStage = "WAIT_BREAK";
      }
    } else if (entryStage === "WAIT_BREAK" && referenceLength !== null && length > referenceLength) {
      referencePrice = armedSide === 1 ? high(1) : low(1);
      referenceLength = length;
      momentumAnchor = referencePrice;
    }
    lastLength = length;
  }

  if (entryStage === "WAIT_BREAK" && referenceLength !== null && length >= referenceLength) {
    const broke = armedSide === 1 ? high(0) >= referencePrice + TICK : low(0) <= referencePrice - TICK;
    if (broke) {
      momentumAnchor = armedSide === 1 ? high(0) : low(0);
      entryStage = "BREAK";
      return;
    }
  } else if (entryStage === "BREAK") {
    const push = Math.max(TICK * 2, atr5 * 0.08);
    const recoil = Math.max(TICK * 2, atr5 * 0.20);
    const hardRecoil = armedSide === 1 ? closeC(0) <= momentumAnchor - recoil : closeC(0) >= momentumAnchor + recoil;
    if (hardRecoil) {
      entryStage = "WAIT_BREAK";
      momentumAnchor = referencePrice;
    } else {
      const p1 = armedSide === 1 ? high(0) >= momentumAnchor + push : low(0) <= momentumAnchor - push;
      if (p1) {
        momentumAnchor = armedSide === 1 ? high(0) : low(0);
        entryStage = "PUSH_1";
      }
    }
  } else if (entryStage === "PUSH_1") {
    const push = Math.max(TICK * 2, atr5 * 0.08);
    const p2 = armedSide === 1 ? high(0) >= momentumAnchor + push : low(0) <= momentumAnchor - push;
    if (p2) entryStage = "ENTRY_READY";
  }
};

onTick = (length, _moment, _, ta, inputs) => {
  if (length < 80) return;
  const memory = Math.max(2, Math.min(20, inputs.swingmemory));
  const pair = selectOuterPair(memory);
  const move = updateCurrentMove(pair.pivots);
  const side = move !== 0 ? move : 0;

  const atr15 = mtf.atr(14, false);
  const atr5 = ta.atr(14);
  const tolerance15 = Math.max(TICK * 4, (finite(atr15) ? atr15 : 20 * TICK) * inputs.tptolerance);
  const entryGap = Math.max(TICK * 4, (finite(atr15) ? atr15 : 20 * TICK) * inputs.tpentrygap);
  const zoneGap = Math.max(TICK * 4, (finite(atr15) ? atr15 : 20 * TICK) * inputs.tpzonegap);

  const rows15 = collectReactionIntervals("15", MAX_MTF_SCAN);
  const rows5 = collectReactionIntervals("5", Math.min(MAX_5M_SCAN, Math.max(10, length - 4)));
  const tol5 = Math.max(TICK * 4, (finite(atr5) ? atr5 : 20 * TICK) * 0.18);

  const long15 = pair.longEntry === null ? [] : ladderFromRows(rows15, "LONG", pair.longEntry, entryGap, zoneGap, tolerance15, inputs.mintouches15, inputs.tppenetration);
  const short15 = pair.shortEntry === null ? [] : ladderFromRows(rows15, "SHORT", pair.shortEntry, entryGap, zoneGap, tolerance15, inputs.mintouches15, inputs.tppenetration);
  const long5 = pair.longEntry === null ? [] : ladderFromRows(rows5, "LONG", pair.longEntry, entryGap, zoneGap, tol5, inputs.mintouches5, inputs.tppenetration);
  const short5 = pair.shortEntry === null ? [] : ladderFromRows(rows5, "SHORT", pair.shortEntry, entryGap, zoneGap, tol5, inputs.mintouches5, inputs.tppenetration);

  const longTp = pair.longEntry === null ? [] : mergeLadders("LONG", pair.longEntry, entryGap, zoneGap, [long15, long5]);
  const shortTp = pair.shortEntry === null ? [] : mergeLadders("SHORT", pair.shortEntry, entryGap, zoneGap, [short15, short5]);

  if (inputs.showentries && pair.longEntry !== null) band.line("🟢 LONG - ENTRY ZONE", pair.longEntry, "#FFBE19", 0, 3, true);
  if (inputs.showentries && pair.shortEntry !== null) band.line("🔴 SHORT - ENTRY ZONE", pair.shortEntry, "#FFBE19", 0, 3, true);

  if (inputs.showtps) {
    longTp.forEach((p, i) => band.line(`🎯 LONG TAKE PROFIT ZONE ${i + 1}`, p, "#2A76FF", 0, 2, true));
    shortTp.forEach((p, i) => band.line(`🎯 SHORT TAKE PROFIT ZONE ${i + 1}`, p, "#2A76FF", 0, 2, true));
  }

  const proof = side === 1 ? pair.longEntry : side === -1 ? pair.shortEntry : null;
  if (side !== 0 && finite(proof) && finite(atr5)) updateEntryState(length, side, proof, atr5);

  // Research candle-quality marker. This does not bypass the standard state silently.
  if (side !== 0 && finite(proof) && length > 4) {
    const engulf = side === 1
      ? closeC(0) > openC(0) && closeC(0) >= Math.max(openC(1), closeC(1)) && openC(0) <= Math.min(openC(1), closeC(1))
      : closeC(0) < openC(0) && openC(0) >= Math.max(openC(1), closeC(1)) && closeC(0) <= Math.min(openC(1), closeC(1));
    const strongBody = bodyFraction(0) >= inputs.strongbody;
    const strongRange = high(0) - low(0) >= atr5 * inputs.strongrange;
    const closeQuality = side === 1 ? closeLocation(0) >= 0.75 && upperWickFraction(0) <= 0.20 : (1 - closeLocation(0)) >= 0.75 && lowerWickFraction(0) <= 0.20;
    const crossed = side === 1 ? closeC(0) > proof : closeC(0) < proof;
    const tp1 = side === 1 ? longTp[0] : shortTp[0];
    const room = finite(tp1) ? Math.abs(proof - tp1) : 0;
    const momentumCandidate = engulf && strongBody && strongRange && closeQuality && crossed && room >= atr5;
    if (momentumCandidate) {
      // Plot a visible marker without pretending this research lane is the standard READY state.
      plot.shapes("Slumdawg Momentum Candidate", side, "⚡", side === 1 ? "#00CD69" : "#E63746", "#FFFFFF", 3, side === 1 ? 1 : -1, 0, "slumdawgmomentumcandidate");
    }
  }
};
