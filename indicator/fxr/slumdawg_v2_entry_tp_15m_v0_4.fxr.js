//@version=1
// Slumdawg FX Replay V2.0.4 — ENTRY-ANCHORED REACTION-ZONE TARGETS
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
//
// Run on 5m NQ/MNQ. This adapter owns CURRENT MOVE, structural Entry Zones,
// 15m + native-chart-5m reaction shelves, TP geometry, and entry-state foundation.
// BIG DIRECTION remains in the separate Daily macro helper. Because FXR does not
// document cross-script shared state, mirror that helper with the BIG DIRECTION input.
//
// v0.4 operator correction:
// - both 15m and 5m reaction searches are anchored to the SAME final 15m Entry Zone;
// - no per-lane TP1/TP2/TP3 pruning before cross-lane canonical shelf fusion;
// - distance may reject/order already-qualified shelves but never creates a TP price;
// - WITH BIG DIRECTION => target exact reaction-zone midpoint;
// - PULLBACK => target safer near-middle (upper-middle for SHORT, lower-middle for LONG);
// - isolated pivots still fail the configured minimum-reaction requirement.

const TICK = 0.25;
const MAX_MTF_SCAN = 320;
const MAX_5M_SCAN = 600;
const MAX_15_SIDE_REACTIONS = 80;
const MAX_5_SIDE_REACTIONS = 120;

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
  input.str("BIG DIRECTION (match Daily helper)", "DOWN", "bigdirection", ["UP", "DOWN"]);
  input.int("Swing Memory", 8, "swingmemory", 2, 20, 1);
  input.int("15m TP Minimum Reactions", 2, "mintouches15", 2, 4, 1);
  input.int("5m TP Minimum Reactions", 3, "mintouches5", 2, 6, 1);
  input.float("Safe pullback penetration", 0.25, "tppenetration", 0.05, 0.45, 0.05);
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
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

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
    const isLow = lane === "15" ? pivotLow15(i) : pivotLow5(i);
    const isHigh = lane === "15" ? pivotHigh15(i) : pivotHigh5(i);

    // Destination polarity matters: a LONG target is prior high-side supply/rejection;
    // a SHORT target is prior low-side demand/rejection. Do not let every pivot qualify
    // for both directions merely because it happens to be above/below the entry.
    if (isHigh && finite(longEntry) && longRows.length < maxPerSide) {
      const z = lane === "15" ? interval15(i, "HIGH") : interval5(i, "HIGH");
      if (z && z.lo >= longEntry + entryGap) longRows.push(z);
    }
    if (isLow && finite(shortEntry) && shortRows.length < maxPerSide) {
      const z = lane === "15" ? interval15(i, "LOW") : interval5(i, "LOW");
      if (z && z.hi <= shortEntry - entryGap) shortRows.push(z);
    }

    if (lane === "5" && includeBodyTurns && !isLow && !isHigh) {
      const bullishTurn = closeC(i) > openC(i) && closeC(i - 1) < openC(i - 1);
      const bearishTurn = closeC(i) < openC(i) && closeC(i - 1) > openC(i - 1);
      const lo = Math.min(openC(i), closeC(i)), hi = Math.max(openC(i), closeC(i));
      if (finite(lo) && finite(hi) && hi > lo) {
        if (bearishTurn && finite(longEntry) && lo >= longEntry + entryGap && longRows.length < maxPerSide) longRows.push({ lo, hi });
        if (bullishTurn && finite(shortEntry) && hi <= shortEntry - entryGap && shortRows.length < maxPerSide) shortRows.push({ lo, hi });
      }
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

const qualifyingClusters = (rows, side, tolerance, minTouches, lane) => {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const c = clusterAt(rows, i, side, tolerance);
    if (!c || c.touches < minTouches) continue;
    const key = `${Math.round(c.lo / TICK)}:${Math.round(c.hi / TICK)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ lo: c.lo, hi: c.hi, touches: c.touches, lane });
  }
  return out;
};

const canonicalizeZones = (lists, fusionGap) => {
  const rows = lists.flat().filter((z) => z && finite(z.lo) && finite(z.hi) && z.hi > z.lo)
    .sort((a, b) => a.lo - b.lo || a.hi - b.hi || b.touches - a.touches);
  if (!rows.length) return [];
  const out = [];
  let cur = { lo: rows[0].lo, hi: rows[0].hi, touches: rows[0].touches };
  for (let i = 1; i < rows.length; i++) {
    const z = rows[i];
    if (z.lo <= cur.hi + fusionGap) {
      cur.lo = Math.min(cur.lo, z.lo);
      cur.hi = Math.max(cur.hi, z.hi);
      cur.touches += z.touches;
    } else {
      out.push(cur);
      cur = { lo: z.lo, hi: z.hi, touches: z.touches };
    }
  }
  out.push(cur);
  return out;
};

const safeTargetFromZone = (zone, side, depth) => {
  const minInside = zone.lo + TICK;
  const maxInside = zone.hi - TICK;
  if (minInside > maxInside) return null;
  const raw = side === "LONG" ? zone.lo + (zone.hi - zone.lo) * depth : zone.hi - (zone.hi - zone.lo) * depth;
  const rounded = side === "LONG" ? roundLongTarget(raw) : roundShortTarget(raw);
  return clamp(rounded, minInside, maxInside);
};

const selectCanonicalTargets = (side, entry, entryGap, zoneGap, zones, depth) => {
  if (!finite(entry)) return [];
  const eligible = zones.filter((z) => side === "LONG" ? z.lo >= entry + entryGap : z.hi <= entry - entryGap)
    .sort((a, b) => {
      const da = side === "LONG" ? a.lo - entry : entry - a.hi;
      const db = side === "LONG" ? b.lo - entry : entry - b.hi;
      return da - db || b.touches - a.touches;
    });
  const out = [];
  let boundary = entry;
  let requiredGap = entryGap;
  for (const z of eligible) {
    const distinct = side === "LONG" ? z.lo >= boundary + requiredGap : z.hi <= boundary - requiredGap;
    if (!distinct) continue;
    const target = safeTargetFromZone(z, side, depth);
    if (!finite(target)) continue;
    out.push({ lo: z.lo, hi: z.hi, target, touches: z.touches });
    boundary = side === "LONG" ? z.hi : z.lo;
    requiredGap = zoneGap;
    if (out.length === 3) break;
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
    entryStage = "WAIT_PROOF"; armedSide = 0; armedProof = null; referencePrice = null; referenceLength = null; momentumAnchor = null;
  }
  if (newBar) {
    if (entryStage === "WAIT_PROOF" && finite(proof)) {
      const crossed = side === 1 ? closeC(1) > proof : closeC(1) < proof;
      if (crossed && bodyFraction(1) >= 0.15) {
        armedSide = side; armedProof = proof; referencePrice = side === 1 ? high(1) : low(1); referenceLength = length; momentumAnchor = referencePrice; entryStage = "WAIT_BREAK";
      }
    } else if (entryStage === "WAIT_BREAK" && referenceLength !== null && length > referenceLength) {
      referencePrice = armedSide === 1 ? high(1) : low(1); referenceLength = length; momentumAnchor = referencePrice;
    }
    lastLength = length;
  }
  if (entryStage === "WAIT_BREAK" && referenceLength !== null && length >= referenceLength) {
    const broke = armedSide === 1 ? high(0) >= referencePrice + TICK : low(0) <= referencePrice - TICK;
    if (broke) { momentumAnchor = armedSide === 1 ? high(0) : low(0); entryStage = "BREAK"; return; }
  } else if (entryStage === "BREAK") {
    const push = Math.max(TICK * 2, atr5 * 0.08), recoil = Math.max(TICK * 2, atr5 * 0.20);
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
  const atr15 = mtf.atr(14, false), atr5 = ta.atr(14);
  const basis15 = finite(atr15) ? atr15 : 20 * TICK;
  const basis5 = finite(atr5) ? atr5 : 20 * TICK;
  const tolerance15 = Math.max(TICK * 4, basis15 * inputs.tptolerance);
  const tolerance5 = Math.max(TICK * 4, basis5 * 0.18);
  const entryGap = Math.max(TICK * 4, basis15 * inputs.tpentrygap);
  const zoneGap = Math.max(TICK * 4, basis15 * inputs.tpzonegap);
  const fusionGap = Math.max(zoneGap, Math.max(TICK * 4, basis15 * inputs.tptolerance));

  const d15 = collectDirectionalReactions("15", MAX_MTF_SCAN, pair.longEntry, pair.shortEntry, entryGap, MAX_15_SIDE_REACTIONS, false);
  const d5 = collectDirectionalReactions("5", Math.min(MAX_5M_SCAN, Math.max(10, length - 4)), pair.longEntry, pair.shortEntry, entryGap, MAX_5_SIDE_REACTIONS, true);

  const longZones = canonicalizeZones([
    qualifyingClusters(d15.longRows, "LONG", tolerance15, inputs.mintouches15, "15"),
    qualifyingClusters(d5.longRows, "LONG", tolerance5, inputs.mintouches5, "5"),
  ], fusionGap);
  const shortZones = canonicalizeZones([
    qualifyingClusters(d15.shortRows, "SHORT", tolerance15, inputs.mintouches15, "15"),
    qualifyingClusters(d5.shortRows, "SHORT", tolerance5, inputs.mintouches5, "5"),
  ], fusionGap);

  const bigDir = inputs.bigdirection === "UP" ? 1 : -1;
  const withBigDirection = move !== 0 && move === bigDir;
  const targetDepth = withBigDirection ? 0.50 : inputs.tppenetration;

  const longTp = selectCanonicalTargets("LONG", pair.longEntry, entryGap, fusionGap, longZones, targetDepth);
  const shortTp = selectCanonicalTargets("SHORT", pair.shortEntry, entryGap, fusionGap, shortZones, targetDepth);

  if (inputs.showentries && pair.longEntry !== null) band.line("🟢 LONG - ENTRY ZONE", pair.longEntry, "#FFBE19", 0, 3, true);
  if (inputs.showentries && pair.shortEntry !== null) band.line("🔴 SHORT - ENTRY ZONE", pair.shortEntry, "#FFBE19", 0, 3, true);
  if (inputs.showtps) {
    const mode = withBigDirection ? "MID" : "SAFE";
    longTp.forEach((z, i) => band.line(`🎯 LONG TP ${i + 1} ${mode}`, z.target, "#2A76FF", 0, 2, true));
    shortTp.forEach((z, i) => band.line(`🎯 SHORT TP ${i + 1} ${mode}`, z.target, "#2A76FF", 0, 2, true));
  }

  const proof = side === 1 ? pair.longEntry : side === -1 ? pair.shortEntry : null;
  if (side !== 0 && finite(proof) && finite(atr5)) updateEntryState(length, side, proof, atr5);
};
