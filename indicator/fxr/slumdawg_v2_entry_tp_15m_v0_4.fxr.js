//@version=1
// Slumdawg FX Replay V2.0.4.2 - FXR-SCOPE-SAFE REACTION-ZONE TARGETS
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
// Run on 5m NQ/MNQ. One requested MTF lane: 15m.

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

const finite = (v) => {
  return typeof v === "number" && isFinite(v);
};

const roundLong = (p) => {
  return Math.ceil((p - 1e-10) / TICK) * TICK;
};

const roundShort = (p) => {
  return Math.floor((p + 1e-10) / TICK) * TICK;
};

const roundLongTarget = (p) => {
  return Math.floor((p + 1e-10) / TICK) * TICK;
};

const roundShortTarget = (p) => {
  return Math.ceil((p - 1e-10) / TICK) * TICK;
};

const clamp = (v, lo, hi) => {
  return Math.min(Math.max(v, lo), hi);
};

const atr5Simple = (period) => {
  let sum = 0;
  let count = 0;
  let i = 0;

  while (i < period) {
    const h = high(i);
    const l = low(i);
    const prev = closeC(i + 1);

    if (finite(h) && finite(l) && finite(prev)) {
      const tr1 = h - l;
      const tr2 = Math.abs(h - prev);
      const tr3 = Math.abs(l - prev);
      const tr = Math.max(tr1, Math.max(tr2, tr3));

      if (finite(tr) && tr >= 0) {
        sum += tr;
        count += 1;
      }
    }

    i += 1;
  }

  if (count === 0) return null;
  return sum / count;
};

const pivotHigh15 = (i) => {
  const h = mtf.high(i, false);
  const h1 = mtf.high(i - 1, false);
  const h2 = mtf.high(i - 2, false);
  const h3 = mtf.high(i + 1, false);
  const h4 = mtf.high(i + 2, false);
  if (!finite(h) || !finite(h1) || !finite(h2) || !finite(h3) || !finite(h4)) return false;
  return h > h1 && h > h2 && h > h3 && h > h4;
};

const pivotLow15 = (i) => {
  const l = mtf.low(i, false);
  const l1 = mtf.low(i - 1, false);
  const l2 = mtf.low(i - 2, false);
  const l3 = mtf.low(i + 1, false);
  const l4 = mtf.low(i + 2, false);
  if (!finite(l) || !finite(l1) || !finite(l2) || !finite(l3) || !finite(l4)) return false;
  return l < l1 && l < l2 && l < l3 && l < l4;
};

const pivotHigh5 = (i) => {
  const h = high(i);
  const h1 = high(i - 1);
  const h2 = high(i - 2);
  const h3 = high(i + 1);
  const h4 = high(i + 2);
  if (!finite(h) || !finite(h1) || !finite(h2) || !finite(h3) || !finite(h4)) return false;
  return h > h1 && h > h2 && h > h3 && h > h4;
};

const pivotLow5 = (i) => {
  const l = low(i);
  const l1 = low(i - 1);
  const l2 = low(i - 2);
  const l3 = low(i + 1);
  const l4 = low(i + 2);
  if (!finite(l) || !finite(l1) || !finite(l2) || !finite(l3) || !finite(l4)) return false;
  return l < l1 && l < l2 && l < l3 && l < l4;
};

const collectPivots15 = (memory) => {
  const highs = [];
  const lows = [];
  let i = 2;
  while (i <= MAX_MTF_SCAN && (highs.length < memory || lows.length < memory)) {
    if (highs.length < memory && pivotHigh15(i)) {
      highs.push({ price: mtf.high(i, false), index: i });
    }
    if (lows.length < memory && pivotLow15(i)) {
      lows.push({ price: mtf.low(i, false), index: i });
    }
    i += 1;
  }
  return { highs: highs, lows: lows };
};

const selectOuterPair = (memory) => {
  const pivots = collectPivots15(memory);
  let outerHigh = null;
  let outerLow = null;
  let i = 0;

  while (i < pivots.highs.length) {
    const highPrice = pivots.highs[i].price;
    if (outerHigh === null || highPrice > outerHigh) outerHigh = highPrice;
    i += 1;
  }

  i = 0;
  while (i < pivots.lows.length) {
    const lowPrice = pivots.lows[i].price;
    if (outerLow === null || lowPrice < outerLow) outerLow = lowPrice;
    i += 1;
  }

  return {
    longEntry: outerHigh === null ? null : roundLong(outerHigh),
    shortEntry: outerLow === null ? null : roundShort(outerLow),
    pivots: pivots
  };
};

const clear15Direction = (p) => {
  if (p.highs.length < 2 || p.lows.length < 2) return 0;
  const h0 = p.highs[0].price;
  const h1 = p.highs[1].price;
  const l0 = p.lows[0].price;
  const l1 = p.lows[1].price;

  if (h0 > h1 && l0 > l1) return 1;
  if (h0 < h1 && l0 < l1) return -1;
  return 0;
};

const updateCurrentMove = (p) => {
  if (p.highs.length === 0 || p.lows.length === 0) return currentMove;

  const structural = clear15Direction(p);
  const c = mtf.closeC(0, false);
  const h0 = p.highs[0].price;
  const l0 = p.lows[0].price;

  if (currentMove === 0) {
    if (structural !== 0) currentMove = structural;
    else if (finite(c) && c > h0) currentMove = 1;
    else if (finite(c) && c < l0) currentMove = -1;
  } else if (currentMove === -1) {
    if (finite(c) && c > h0) currentMove = 1;
  } else {
    if (finite(c) && c < l0) currentMove = -1;
  }

  return currentMove;
};

const interval15 = (i, kind) => {
  let lo = null;
  let hi = null;

  if (kind === "LOW") {
    lo = mtf.low(i, false);
    hi = Math.min(mtf.openC(i, false), mtf.closeC(i, false));
  } else {
    lo = Math.max(mtf.openC(i, false), mtf.closeC(i, false));
    hi = mtf.high(i, false);
  }

  if (!finite(lo) || !finite(hi) || hi <= lo) return null;
  return { lo: lo, hi: hi };
};

const interval5 = (i, kind) => {
  let lo = null;
  let hi = null;

  if (kind === "LOW") {
    lo = low(i);
    hi = Math.min(openC(i), closeC(i));
  } else {
    lo = Math.max(openC(i), closeC(i));
    hi = high(i);
  }

  if (!finite(lo) || !finite(hi) || hi <= lo) return null;
  return { lo: lo, hi: hi };
};

const collectDirectionalReactions = (lane, scan, longEntry, shortEntry, entryGap, maxPerSide, includeBodyTurns) => {
  const longRows = [];
  const shortRows = [];
  let i = 3;

  while (i <= scan) {
    const isLow = lane === "15" ? pivotLow15(i) : pivotLow5(i);
    const isHigh = lane === "15" ? pivotHigh15(i) : pivotHigh5(i);

    if (isHigh && finite(longEntry) && longRows.length < maxPerSide) {
      const zHigh = lane === "15" ? interval15(i, "HIGH") : interval5(i, "HIGH");
      if (zHigh !== null && zHigh.lo >= longEntry + entryGap) {
        longRows.push(zHigh);
      }
    }

    if (isLow && finite(shortEntry) && shortRows.length < maxPerSide) {
      const zLow = lane === "15" ? interval15(i, "LOW") : interval5(i, "LOW");
      if (zLow !== null && zLow.hi <= shortEntry - entryGap) {
        shortRows.push(zLow);
      }
    }

    if (lane === "5" && includeBodyTurns && !isLow && !isHigh) {
      const bullishTurn = closeC(i) > openC(i) && closeC(i - 1) < openC(i - 1);
      const bearishTurn = closeC(i) < openC(i) && closeC(i - 1) > openC(i - 1);
      const bodyLo = Math.min(openC(i), closeC(i));
      const bodyHi = Math.max(openC(i), closeC(i));

      if (finite(bodyLo) && finite(bodyHi) && bodyHi > bodyLo) {
        if (bearishTurn && finite(longEntry) && bodyLo >= longEntry + entryGap && longRows.length < maxPerSide) {
          longRows.push({ lo: bodyLo, hi: bodyHi });
        }
        if (bullishTurn && finite(shortEntry) && bodyHi <= shortEntry - entryGap && shortRows.length < maxPerSide) {
          shortRows.push({ lo: bodyLo, hi: bodyHi });
        }
      }
    }

    if (longRows.length >= maxPerSide && shortRows.length >= maxPerSide) break;
    i += 1;
  }

  return { longRows: longRows, shortRows: shortRows };
};

const clusterAt = (rows, seedIndex, side, tolerance) => {
  const seed = rows[seedIndex];
  const edge = side === "LONG" ? seed.lo : seed.hi;
  let lo = 1000000000000;
  let hi = -1000000000000;
  let touches = 0;
  let i = 0;

  while (i < rows.length) {
    const row = rows[i];
    const rowEdge = side === "LONG" ? row.lo : row.hi;
    if (Math.abs(rowEdge - edge) <= tolerance) {
      touches += 1;
      lo = Math.min(lo, row.lo);
      hi = Math.max(hi, row.hi);
    }
    i += 1;
  }

  if (touches === 0) return null;
  return { lo: lo, hi: hi, touches: touches };
};

const qualifyingClusters = (rows, side, tolerance, minTouches) => {
  const out = [];
  let i = 0;

  while (i < rows.length) {
    const c = clusterAt(rows, i, side, tolerance);
    if (c !== null && c.touches >= minTouches) {
      const loTick = Math.round(c.lo / TICK);
      const hiTick = Math.round(c.hi / TICK);
      let duplicate = false;
      let j = 0;

      while (j < out.length) {
        const oldLoTick = Math.round(out[j].lo / TICK);
        const oldHiTick = Math.round(out[j].hi / TICK);
        if (oldLoTick === loTick && oldHiTick === hiTick) {
          duplicate = true;
          break;
        }
        j += 1;
      }

      if (!duplicate) {
        out.push({ lo: c.lo, hi: c.hi, touches: c.touches });
      }
    }
    i += 1;
  }

  return out;
};

const canonicalizeZones = (first, second, fusionGap) => {
  const rows = [];
  let i = 0;

  while (i < first.length) {
    rows.push(first[i]);
    i += 1;
  }

  i = 0;
  while (i < second.length) {
    rows.push(second[i]);
    i += 1;
  }

  rows.sort((a, b) => {
    if (a.lo !== b.lo) return a.lo - b.lo;
    if (a.hi !== b.hi) return a.hi - b.hi;
    return b.touches - a.touches;
  });

  if (rows.length === 0) return [];

  const out = [];
  let cur = {
    lo: rows[0].lo,
    hi: rows[0].hi,
    touches: rows[0].touches
  };

  i = 1;
  while (i < rows.length) {
    const z = rows[i];
    if (z.lo <= cur.hi + fusionGap) {
      cur.lo = Math.min(cur.lo, z.lo);
      cur.hi = Math.max(cur.hi, z.hi);
      cur.touches += z.touches;
    } else {
      out.push(cur);
      cur = { lo: z.lo, hi: z.hi, touches: z.touches };
    }
    i += 1;
  }

  out.push(cur);
  return out;
};

const safeTargetFromZone = (zone, side, depth) => {
  const minInside = zone.lo + TICK;
  const maxInside = zone.hi - TICK;
  if (minInside > maxInside) return null;

  const width = zone.hi - zone.lo;
  const raw = side === "LONG"
    ? zone.lo + width * depth
    : zone.hi - width * depth;

  const rounded = side === "LONG"
    ? roundLongTarget(raw)
    : roundShortTarget(raw);

  return clamp(rounded, minInside, maxInside);
};

const selectCanonicalTargets = (side, entry, entryGap, zoneGap, zones, depth) => {
  if (!finite(entry)) return [];

  const eligible = [];
  let i = 0;

  while (i < zones.length) {
    const candidateZone = zones[i];
    const ok = side === "LONG"
      ? candidateZone.lo >= entry + entryGap
      : candidateZone.hi <= entry - entryGap;

    if (ok) eligible.push(candidateZone);
    i += 1;
  }

  eligible.sort((a, b) => {
    const da = side === "LONG" ? a.lo - entry : entry - a.hi;
    const db = side === "LONG" ? b.lo - entry : entry - b.hi;
    if (da !== db) return da - db;
    return b.touches - a.touches;
  });

  const out = [];
  let boundary = entry;
  let requiredGap = entryGap;
  i = 0;

  while (i < eligible.length && out.length < 3) {
    const selectedZone = eligible[i];
    const distinct = side === "LONG"
      ? selectedZone.lo >= boundary + requiredGap
      : selectedZone.hi <= boundary - requiredGap;

    if (distinct) {
      const target = safeTargetFromZone(selectedZone, side, depth);
      if (finite(target)) {
        out.push({
          lo: selectedZone.lo,
          hi: selectedZone.hi,
          target: target,
          touches: selectedZone.touches
        });

        boundary = side === "LONG" ? selectedZone.hi : selectedZone.lo;
        requiredGap = zoneGap;
      }
    }
    i += 1;
  }

  return out;
};

const bodyFraction = (i) => {
  const range = high(i) - low(i);
  if (range <= 0) return 0;
  return Math.abs(closeC(i) - openC(i)) / range;
};

const updateEntryState = (length, side, proof, atr5) => {
  const newBar = length > lastLength;

  if (lastLength === 0) lastLength = length;

  if (
    armedSide !== 0 &&
    (
      armedSide !== side ||
      !finite(proof) ||
      !finite(armedProof) ||
      Math.abs(proof - armedProof) >= TICK
    )
  ) {
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
    const broke = armedSide === 1
      ? high(0) >= referencePrice + TICK
      : low(0) <= referencePrice - TICK;

    if (broke) {
      momentumAnchor = armedSide === 1 ? high(0) : low(0);
      entryStage = "BREAK";
      return;
    }
  } else if (entryStage === "BREAK") {
    const pushBreak = Math.max(TICK * 2, atr5 * 0.08);
    const recoil = Math.max(TICK * 2, atr5 * 0.20);
    const hard = armedSide === 1
      ? closeC(0) <= momentumAnchor - recoil
      : closeC(0) >= momentumAnchor + recoil;

    if (hard) {
      entryStage = "WAIT_BREAK";
      momentumAnchor = referencePrice;
    } else {
      const p1 = armedSide === 1
        ? high(0) >= momentumAnchor + pushBreak
        : low(0) <= momentumAnchor - pushBreak;

      if (p1) {
        momentumAnchor = armedSide === 1 ? high(0) : low(0);
        entryStage = "PUSH_1";
      }
    }
  } else if (entryStage === "PUSH_1") {
    const pushSecond = Math.max(TICK * 2, atr5 * 0.08);
    const p2 = armedSide === 1
      ? high(0) >= momentumAnchor + pushSecond
      : low(0) <= momentumAnchor - pushSecond;

    if (p2) entryStage = "ENTRY_READY";
  }
};

const drawTargets = (rows, sideName, mode) => {
  let i = 0;
  while (i < rows.length) {
    const name = sideName + " TP " + String(i + 1) + " " + mode;
    band.line(name, rows[i].target, "#2A76FF", 0, 2, true);
    i += 1;
  }
};

onTick = (length, _moment, _, ta, inputs) => {
  if (length < 100) return;

  const memory = Math.max(2, Math.min(20, inputs.swingmemory));
  const pair = selectOuterPair(memory);
  const move = updateCurrentMove(pair.pivots);
  const side = move;

  const atr15 = mtf.atr(14, false);
  const atr5 = atr5Simple(14);
  const basis15 = finite(atr15) ? atr15 : 20 * TICK;
  const basis5 = finite(atr5) ? atr5 : 20 * TICK;

  const tolerance15 = Math.max(TICK * 4, basis15 * inputs.tptolerance);
  const tolerance5 = Math.max(TICK * 4, basis5 * 0.18);
  const entryGap = Math.max(TICK * 4, basis15 * inputs.tpentrygap);
  const zoneGap = Math.max(TICK * 4, basis15 * inputs.tpzonegap);
  const fusionGap = Math.max(zoneGap, Math.max(TICK * 4, basis15 * inputs.tptolerance));

  const scan5 = Math.min(MAX_5M_SCAN, Math.max(10, length - 4));

  const d15 = collectDirectionalReactions(
    "15",
    MAX_MTF_SCAN,
    pair.longEntry,
    pair.shortEntry,
    entryGap,
    MAX_15_SIDE_REACTIONS,
    false
  );

  const d5 = collectDirectionalReactions(
    "5",
    scan5,
    pair.longEntry,
    pair.shortEntry,
    entryGap,
    MAX_5_SIDE_REACTIONS,
    true
  );

  const long15 = qualifyingClusters(
    d15.longRows,
    "LONG",
    tolerance15,
    inputs.mintouches15
  );

  const long5 = qualifyingClusters(
    d5.longRows,
    "LONG",
    tolerance5,
    inputs.mintouches5
  );

  const short15 = qualifyingClusters(
    d15.shortRows,
    "SHORT",
    tolerance15,
    inputs.mintouches15
  );

  const short5 = qualifyingClusters(
    d5.shortRows,
    "SHORT",
    tolerance5,
    inputs.mintouches5
  );

  const longZones = canonicalizeZones(long15, long5, fusionGap);
  const shortZones = canonicalizeZones(short15, short5, fusionGap);

  const bigDir = inputs.bigdirection === "UP" ? 1 : -1;
  const withBigDirection = move !== 0 && move === bigDir;
  const targetDepth = withBigDirection ? 0.50 : inputs.tppenetration;

  const longTp = selectCanonicalTargets(
    "LONG",
    pair.longEntry,
    entryGap,
    fusionGap,
    longZones,
    targetDepth
  );

  const shortTp = selectCanonicalTargets(
    "SHORT",
    pair.shortEntry,
    entryGap,
    fusionGap,
    shortZones,
    targetDepth
  );

  if (inputs.showentries && pair.longEntry !== null) {
    band.line("LONG ENTRY ZONE", pair.longEntry, "#FFBE19", 0, 3, true);
  }

  if (inputs.showentries && pair.shortEntry !== null) {
    band.line("SHORT ENTRY ZONE", pair.shortEntry, "#FFBE19", 0, 3, true);
  }

  if (inputs.showtps) {
    const mode = withBigDirection ? "MID" : "SAFE";
    drawTargets(longTp, "LONG", mode);
    drawTargets(shortTp, "SHORT", mode);
  }

  let proof = null;
  if (side === 1) proof = pair.longEntry;
  else if (side === -1) proof = pair.shortEntry;

  if (side !== 0 && finite(proof) && finite(atr5)) {
    updateEntryState(length, side, proof, atr5);
  }
};