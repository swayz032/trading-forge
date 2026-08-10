//@version=1
// Slumdawg FX Replay V2.0.3 — 15m Current Move + Entry + DISTINCT TP shelves
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
//
// Run on 5m NQ/MNQ. This adapter owns CURRENT MOVE, structural Entry Zones,
// 15m/5m Take Profit shelves, and the standard entry-state foundation.
// BIG DIRECTION comes from the separate Daily macro helper in the V2 bundle.
//
// v0.3 parity correction:
// - ladder candidates carry full {lo, hi, target} zone identity;
// - adjacent/overlapping 5m and 15m views of one physical shelf count once;
// - TP2/TP3 must be entirely beyond the prior selected shelf plus the larger of
//   normal zone separation and the calibrated cluster/fusion tolerance.

const TICK = 0.25;
const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;
const MAX_MTF_SCAN = 320;
const MAX_5M_SCAN = 600;
const MAX_15_SIDE_REACTIONS = 48;
const MAX_5_SIDE_REACTIONS = 64;

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
  const highs = [], lows = [];
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

const clear15Direction = (p) => {
  if (p.highs.length < 2 || p.lows.length < 2) return 0;
  const h0 = p.highs[0].price, h1 = p.highs[1].price;
  const l0 = p.lows[0].price, l1 = p.lows[1].price;
  if (h0 > h1 && l0 > l1) return 1;
  if (h0 < h1 && l0 < l1) return -1;
  return 0;
};

const updateCurrentMove = (p) => {
  if (!p.highs.length || !p.lows.length) return currentMove;
  const structural = clear15Direction(p);
  const c = mtf.closeC(0, false);
  const h0 = p.highs[0].price, l0 = p.lows[0].price;
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

const collectDirectionalReactions = (lane, scan, longEntry, shortEntry, entryGap, maxPerSide, includeBodyTurns) => {
  const longRows = [], shortRows = [];
  for (let i = 3; i <= scan; i++) {
    let candidates = [];
    if (lane === "15") {
      if (pivotLow15(i)) { const z = interval15(i, "LOW"); if (z) candidates.push(z); }
      if (pivotHigh15(i)) { const z = interval15(i, "HIGH"); if (z) candidates.push(z); }
    } else {
      const isLow = pivotLow5(i), isHigh = pivotHigh5(i);
      if (isLow) { const z = interval5(i, "LOW"); if (z) candidates.push(z); }
      if (isHigh) { const z = interval5(i, "HIGH"); if (z) candidates.push(z); }
      if (includeBodyTurns && !isLow && !isHigh) {
        const flip = (closeC(i) > openC(i) && closeC(i - 1) < openC(i - 1)) || (closeC(i) < openC(i) && closeC(i - 1) > openC(i - 1));
        if (flip) {
          const lo = Math.min(openC(i), closeC(i)), hi = Math.max(openC(i), closeC(i));
          if (finite(lo) && finite(hi) && hi > lo) candidates.push({ lo, hi });
        }
      }
    }

    for (const z of candidates) {
      if (finite(longEntry) && z.lo >= longEntry + entryGap && longRows.length < maxPerSide) longRows.push(z);
      if (finite(shortEntry) && z.hi <= shortEntry - entryGap && shortRows.length < maxPerSide) shortRows.push(z);
    }
    if (longRows.length >= maxPerSide && shortRows.length >= maxPerSide) break;
  }
  return { longRows, shortRows };
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
    const target = side === "LONG" ? roundLongTarget(raw) : roundShortTarget(raw);
    out.push({ lo: c.lo, hi: c.hi, target, touches: c.touches });
    boundary = side === "LONG" ? c.hi : c.lo;
    gap = zoneGap;
  }
  return out;
};

const mergeDistinctZones = (side, entry, entryGap, distinctZoneGap, lists) => {
  const candidates = lists.flat().filter((z) => z && finite(z.lo) && finite(z.hi) && finite(z.target));
  const out = [];
  let boundary = entry;
  let gap = entryGap;

  for (let n = 0; n < 3; n++) {
    let best = null, bestDist = Infinity;
    for (const z of candidates) {
      // Full-zone separation, not target-price separation.
      const ok = side === "LONG" ? z.lo >= boundary + gap : z.hi <= boundary - gap;
      if (!ok) continue;
      const dist = side === "LONG" ? z.lo - boundary : boundary - z.hi;
      if (dist < bestDist || (dist === bestDist && best && z.touches > best.touches)) {
        best = z;
        bestDist = dist;
      }
    }
    if (!best) break;
    out.push(best);
    boundary = side === "LONG" ? best.hi : best.lo;
    gap = distinctZoneGap;
  }
  return out;
};

const bodyFraction = (i) => {
  const r = high(i) - low(i);
  return r > 0 ? Math.abs(closeC(i) - openC(i)) / r : 0;
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
    if (broke) { momentumAnchor = armedSide === 1 ? high(0) : low(0); entryStage = "BREAK"; return; }
  } else if (entryStage === "BREAK") {
    const push = Math.max(TICK * 2, atr5 * 0.08);
    const recoil = Math.max(TICK * 2, atr5 * 0.20);
    const hard = armedSide === 1 ? closeC(0) <= momentumAnchor - recoil : closeC(0) >= momentumAnchor + recoil;
    if (hard) { entryStage = "WAIT_BREAK"; momentumAnchor = referencePrice; }
    else {
      const p1 = armedSide === 1 ? high(0) >= momentumAnchor + push : low(0) <= momentumAnchor - push;
      if (p1) { momentumAnchor = armedSide === 1 ? high(0) : low(0); entryStage = "PUSH_1"; }
    }
  } else if (entryStage === "PUSH_1") {
    const push = Math.max(TICK * 2, atr5 * 0.08);
    const p2 = armedSide === 1 ? high(0) >= momentumAnchor + push : low(0) <= momentumAnchor - push;
    if (p2) entryStage = "ENTRY_READY";
  }
};

onTick = (length, _moment, _, ta, inputs) => {
  if (length < 100) return;
  const memory = Math.max(2, Math.min(20, inputs.swingmemory));
  const pair = selectOuterPair(memory);
  const move = updateCurrentMove(pair.pivots);
  const side = move;
  const atr15 = mtf.atr(14, false);
  const atr5 = ta.atr(14);
  const basis15 = finite(atr15) ? atr15 : 20 * TICK;
  const basis5 = finite(atr5) ? atr5 : 20 * TICK;
  const tolerance15 = Math.max(TICK * 4, basis15 * inputs.tptolerance);
  const tolerance5 = Math.max(TICK * 4, basis5 * 0.18);
  const entryGap = Math.max(TICK * 4, basis15 * inputs.tpentrygap);
  const zoneGap = Math.max(TICK * 4, basis15 * inputs.tpzonegap);
  const shelfFusionGap = Math.max(TICK * 4, basis15 * inputs.tptolerance);
  const distinctZoneGap = Math.max(zoneGap, shelfFusionGap);

  const d15 = collectDirectionalReactions("15", MAX_MTF_SCAN, pair.longEntry, pair.shortEntry, entryGap, MAX_15_SIDE_REACTIONS, false);
  const d5 = collectDirectionalReactions("5", Math.min(MAX_5M_SCAN, Math.max(10, length - 4)), pair.longEntry, pair.shortEntry, entryGap, MAX_5_SIDE_REACTIONS, true);

  const long15 = pair.longEntry === null ? [] : ladderFromRows(d15.longRows, "LONG", pair.longEntry, entryGap, zoneGap, tolerance15, inputs.mintouches15, inputs.tppenetration);
  const short15 = pair.shortEntry === null ? [] : ladderFromRows(d15.shortRows, "SHORT", pair.shortEntry, entryGap, zoneGap, tolerance15, inputs.mintouches15, inputs.tppenetration);
  const long5 = pair.longEntry === null ? [] : ladderFromRows(d5.longRows, "LONG", pair.longEntry, entryGap, zoneGap, tolerance5, inputs.mintouches5, inputs.tppenetration);
  const short5 = pair.shortEntry === null ? [] : ladderFromRows(d5.shortRows, "SHORT", pair.shortEntry, entryGap, zoneGap, tolerance5, inputs.mintouches5, inputs.tppenetration);

  const longTp = pair.longEntry === null ? [] : mergeDistinctZones("LONG", pair.longEntry, entryGap, distinctZoneGap, [long15, long5]);
  const shortTp = pair.shortEntry === null ? [] : mergeDistinctZones("SHORT", pair.shortEntry, entryGap, distinctZoneGap, [short15, short5]);

  if (inputs.showentries && pair.longEntry !== null) band.line("🟢 LONG - ENTRY ZONE", pair.longEntry, "#FFBE19", 0, 3, true);
  if (inputs.showentries && pair.shortEntry !== null) band.line("🔴 SHORT - ENTRY ZONE", pair.shortEntry, "#FFBE19", 0, 3, true);
  if (inputs.showtps) {
    longTp.forEach((z, i) => band.line(`🎯 LONG TAKE PROFIT ZONE ${i + 1}`, z.target, "#2A76FF", 0, 2, true));
    shortTp.forEach((z, i) => band.line(`🎯 SHORT TAKE PROFIT ZONE ${i + 1}`, z.target, "#2A76FF", 0, 2, true));
  }

  const proof = side === 1 ? pair.longEntry : side === -1 ? pair.shortEntry : null;
  if (side !== 0 && finite(proof) && finite(atr5)) updateEntryState(length, side, proof, atr5);
};
