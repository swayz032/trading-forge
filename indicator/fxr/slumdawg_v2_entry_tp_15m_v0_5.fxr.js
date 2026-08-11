//@version=1
// Slumdawg FX Replay V2.0.5.0 - FULL REACTION-BODY ZONES + FIRST-SHELF TP
// PLATFORM PARITY / RESEARCH ONLY. NOT LIVE-DECISION-SUPPORT APPROVED.
// Run on 5m NQ/MNQ. One requested MTF lane: 15m.
//
// v0.5 operator correction:
// - upper reaction zone = full body bottom -> high (not body-top -> wick-high)
// - lower reaction zone = low -> full body top (not wick-low -> body-bottom)
// - quality before distance; nearest QUALIFIED physical shelf owns TP1
// - 5m/15m same shelf fuses before numbering
// - LONG target = middle with slight upper lean (0.55 research default)
// - SHORT target = middle (0.50 research default)
// - hard profit-side guards against Entry and rolled live reference
// - exact white-line case prices are golden validation data, never hard-coded outputs
//
// Persistent mutable state only. Primitive top-level constants are intentionally avoided
// because FX Replay v1 may evaluate helper functions in a narrower runtime scope.
// [0]=currentMove [1]=entryStage [2]=armedSide [3]=armedProof
// [4]=referencePrice [5]=referenceLength [6]=momentumAnchor [7]=lastLength
const runtimeState = [0, "WAIT_PROOF", 0, null, null, null, null, 0];

init = () => {
  indicator({ onMainPanel: true, format: "inherit" });
  input.bool("Show Entry Zones", true, "showentries");
  input.bool("Show Take Profit Zones", true, "showtps");
  input.bool("Show FXR heartbeat while testing", true, "showheartbeat");
  input.str("BIG DIRECTION (match Daily helper)", "DOWN", "bigdirection", ["UP", "DOWN"]);
  input.int("Swing Memory", 8, "swingmemory", 2, 20, 1);
  input.int("15m TP Minimum Reactions", 2, "mintouches15", 2, 4, 1);
  input.int("5m TP Minimum Reactions", 2, "mintouches5", 2, 5, 1);
  input.float("Reaction Edge Tolerance x ATR", 0.30, "tptolerance", 0.05, 1.00, 0.05);
  input.float("TP Entry Separation x 15m ATR", 0.25, "tpentrygap", 0.05, 1.50, 0.05);
  input.float("TP-to-TP Separation x 15m ATR", 0.12, "tpzonegap", 0.05, 0.75, 0.01);
  input.float("5m/15m Same-Shelf Fusion x 15m ATR", 0.35, "tpfusion", 0.05, 1.25, 0.05);
  input.int("Reaction Confirmation Bars", 6, "reactionbars", 2, 20, 1);
  input.float("Minimum Reaction Displacement x ATR", 0.75, "minreactionatr", 0.10, 3.00, 0.05);
  input.float("LONG Target Depth Inside Zone", 0.55, "longdepth", 0.50, 0.70, 0.01);
  input.float("SHORT Target Depth Inside Zone", 0.50, "shortdepth", 0.35, 0.60, 0.01);
  mtf.timeframe("15");
};

const finite = (v) => {
  return typeof v === "number" && isFinite(v);
};

const roundUpTick = (p) => {
  return Math.ceil((p - 1e-10) / 0.25) * 0.25;
};

const roundDownTick = (p) => {
  return Math.floor((p + 1e-10) / 0.25) * 0.25;
};

const clampValue = (v, lo, hi) => {
  return Math.min(Math.max(v, lo), hi);
};

const atr5Simple = (period) => {
  var sumAtr = 0;
  var countAtr = 0;
  var idxAtr = 0;
  while (idxAtr < period) {
    var hAtr = high(idxAtr);
    var lAtr = low(idxAtr);
    var prevAtr = closeC(idxAtr + 1);
    if (finite(hAtr) && finite(lAtr) && finite(prevAtr)) {
      var trA = hAtr - lAtr;
      var trB = Math.abs(hAtr - prevAtr);
      var trC = Math.abs(lAtr - prevAtr);
      var trVal = Math.max(trA, Math.max(trB, trC));
      if (finite(trVal) && trVal >= 0) {
        sumAtr += trVal;
        countAtr += 1;
      }
    }
    idxAtr += 1;
  }
  return countAtr === 0 ? null : sumAtr / countAtr;
};

const pivotHigh15 = (i) => {
  var h0p15 = mtf.high(i, false);
  var h1p15 = mtf.high(i - 1, false);
  var h2p15 = mtf.high(i - 2, false);
  var h3p15 = mtf.high(i + 1, false);
  var h4p15 = mtf.high(i + 2, false);
  if (!finite(h0p15) || !finite(h1p15) || !finite(h2p15) || !finite(h3p15) || !finite(h4p15)) return false;
  return h0p15 > h1p15 && h0p15 > h2p15 && h0p15 > h3p15 && h0p15 > h4p15;
};

const pivotLow15 = (i) => {
  var l0p15 = mtf.low(i, false);
  var l1p15 = mtf.low(i - 1, false);
  var l2p15 = mtf.low(i - 2, false);
  var l3p15 = mtf.low(i + 1, false);
  var l4p15 = mtf.low(i + 2, false);
  if (!finite(l0p15) || !finite(l1p15) || !finite(l2p15) || !finite(l3p15) || !finite(l4p15)) return false;
  return l0p15 < l1p15 && l0p15 < l2p15 && l0p15 < l3p15 && l0p15 < l4p15;
};

const pivotHigh5 = (i) => {
  var h0p5 = high(i);
  var h1p5 = high(i - 1);
  var h2p5 = high(i - 2);
  var h3p5 = high(i + 1);
  var h4p5 = high(i + 2);
  if (!finite(h0p5) || !finite(h1p5) || !finite(h2p5) || !finite(h3p5) || !finite(h4p5)) return false;
  return h0p5 > h1p5 && h0p5 > h2p5 && h0p5 > h3p5 && h0p5 > h4p5;
};

const pivotLow5 = (i) => {
  var l0p5 = low(i);
  var l1p5 = low(i - 1);
  var l2p5 = low(i - 2);
  var l3p5 = low(i + 1);
  var l4p5 = low(i + 2);
  if (!finite(l0p5) || !finite(l1p5) || !finite(l2p5) || !finite(l3p5) || !finite(l4p5)) return false;
  return l0p5 < l1p5 && l0p5 < l2p5 && l0p5 < l3p5 && l0p5 < l4p5;
};

const collectPivots15 = (memory, scanLimit) => {
  var highsOut = [];
  var lowsOut = [];
  var idxPiv = 2;
  while (idxPiv <= scanLimit && (highsOut.length < memory || lowsOut.length < memory)) {
    if (highsOut.length < memory && pivotHigh15(idxPiv)) {
      highsOut.push({ price: mtf.high(idxPiv, false), index: idxPiv });
    }
    if (lowsOut.length < memory && pivotLow15(idxPiv)) {
      lowsOut.push({ price: mtf.low(idxPiv, false), index: idxPiv });
    }
    idxPiv += 1;
  }
  return { highs: highsOut, lows: lowsOut };
};

const selectOuterPair = (memory, scanLimit) => {
  var pivPair = collectPivots15(memory, scanLimit);
  var outerHighPair = null;
  var outerLowPair = null;
  var idxHighPair = 0;
  while (idxHighPair < pivPair.highs.length) {
    var priceHighPair = pivPair.highs[idxHighPair].price;
    if (outerHighPair === null || priceHighPair > outerHighPair) outerHighPair = priceHighPair;
    idxHighPair += 1;
  }
  var idxLowPair = 0;
  while (idxLowPair < pivPair.lows.length) {
    var priceLowPair = pivPair.lows[idxLowPair].price;
    if (outerLowPair === null || priceLowPair < outerLowPair) outerLowPair = priceLowPair;
    idxLowPair += 1;
  }
  return {
    longEntry: outerHighPair === null ? null : roundUpTick(outerHighPair),
    shortEntry: outerLowPair === null ? null : roundDownTick(outerLowPair),
    pivots: pivPair
  };
};

const clear15Direction = (pivDir) => {
  if (pivDir.highs.length < 2 || pivDir.lows.length < 2) return 0;
  var h0dir = pivDir.highs[0].price;
  var h1dir = pivDir.highs[1].price;
  var l0dir = pivDir.lows[0].price;
  var l1dir = pivDir.lows[1].price;
  if (h0dir > h1dir && l0dir > l1dir) return 1;
  if (h0dir < h1dir && l0dir < l1dir) return -1;
  return 0;
};

const updateCurrentMove = (pivMove, stateMove) => {
  var moveVal = stateMove[0];
  if (pivMove.highs.length === 0 || pivMove.lows.length === 0) return moveVal;
  var structuralMove = clear15Direction(pivMove);
  var closeMove = mtf.closeC(0, false);
  var highMove = pivMove.highs[0].price;
  var lowMove = pivMove.lows[0].price;
  if (moveVal === 0) {
    if (structuralMove !== 0) moveVal = structuralMove;
    else if (finite(closeMove) && closeMove > highMove) moveVal = 1;
    else if (finite(closeMove) && closeMove < lowMove) moveVal = -1;
  } else if (moveVal === -1) {
    if (finite(closeMove) && closeMove > highMove) moveVal = 1;
  } else if (finite(closeMove) && closeMove < lowMove) {
    moveVal = -1;
  }
  stateMove[0] = moveVal;
  return moveVal;
};

const reactionDown15 = (i, confirmBars, zoneNear, atrBasis) => {
  var postLow15 = null;
  var usable15 = Math.min(confirmBars, i);
  var kDown15 = 1;
  while (kDown15 <= usable15) {
    var valDown15 = mtf.low(i - kDown15, false);
    if (finite(valDown15) && (postLow15 === null || valDown15 < postLow15)) postLow15 = valDown15;
    kDown15 += 1;
  }
  if (postLow15 === null || !finite(atrBasis) || atrBasis <= 0) return 0;
  return Math.max(0, zoneNear - postLow15) / atrBasis;
};

const reactionUp15 = (i, confirmBars, zoneNear, atrBasis) => {
  var postHigh15 = null;
  var usableUp15 = Math.min(confirmBars, i);
  var kUp15 = 1;
  while (kUp15 <= usableUp15) {
    var valUp15 = mtf.high(i - kUp15, false);
    if (finite(valUp15) && (postHigh15 === null || valUp15 > postHigh15)) postHigh15 = valUp15;
    kUp15 += 1;
  }
  if (postHigh15 === null || !finite(atrBasis) || atrBasis <= 0) return 0;
  return Math.max(0, postHigh15 - zoneNear) / atrBasis;
};

const reactionDown5 = (i, confirmBars, zoneNear, atrBasis) => {
  var postLow5 = null;
  var usable5 = Math.min(confirmBars, i);
  var kDown5 = 1;
  while (kDown5 <= usable5) {
    var valDown5 = low(i - kDown5);
    if (finite(valDown5) && (postLow5 === null || valDown5 < postLow5)) postLow5 = valDown5;
    kDown5 += 1;
  }
  if (postLow5 === null || !finite(atrBasis) || atrBasis <= 0) return 0;
  return Math.max(0, zoneNear - postLow5) / atrBasis;
};

const reactionUp5 = (i, confirmBars, zoneNear, atrBasis) => {
  var postHigh5 = null;
  var usableUp5 = Math.min(confirmBars, i);
  var kUp5 = 1;
  while (kUp5 <= usableUp5) {
    var valUp5 = high(i - kUp5);
    if (finite(valUp5) && (postHigh5 === null || valUp5 > postHigh5)) postHigh5 = valUp5;
    kUp5 += 1;
  }
  if (postHigh5 === null || !finite(atrBasis) || atrBasis <= 0) return 0;
  return Math.max(0, postHigh5 - zoneNear) / atrBasis;
};

const collectDirectionalReactions = (lane, scan, longEntry, shortEntry, entryGap, maxPerSide, confirmBars, minReaction, atrBasis) => {
  var longRows = [];
  var shortRows = [];
  var idxReact = 3;
  while (idxReact <= scan) {
    var isLowReact = lane === "15" ? pivotLow15(idxReact) : pivotLow5(idxReact);
    var isHighReact = lane === "15" ? pivotHigh15(idxReact) : pivotHigh5(idxReact);
    if (isHighReact && finite(longEntry) && longRows.length < maxPerSide) {
      var openHighReact = lane === "15" ? mtf.openC(idxReact, false) : openC(idxReact);
      var closeHighReact = lane === "15" ? mtf.closeC(idxReact, false) : closeC(idxReact);
      var highHighReact = lane === "15" ? mtf.high(idxReact, false) : high(idxReact);
      var loHighZone = Math.min(openHighReact, closeHighReact);
      var hiHighZone = highHighReact;
      var strengthHighZone = lane === "15"
        ? reactionDown15(idxReact, confirmBars, loHighZone, atrBasis)
        : reactionDown5(idxReact, confirmBars, loHighZone, atrBasis);
      if (finite(loHighZone) && finite(hiHighZone) && hiHighZone > loHighZone && loHighZone >= longEntry + entryGap && strengthHighZone >= minReaction) {
        longRows.push({ lo: loHighZone, hi: hiHighZone, strength: strengthHighZone });
      }
    }
    if (isLowReact && finite(shortEntry) && shortRows.length < maxPerSide) {
      var openLowReact = lane === "15" ? mtf.openC(idxReact, false) : openC(idxReact);
      var closeLowReact = lane === "15" ? mtf.closeC(idxReact, false) : closeC(idxReact);
      var lowLowReact = lane === "15" ? mtf.low(idxReact, false) : low(idxReact);
      var loLowZone = lowLowReact;
      var hiLowZone = Math.max(openLowReact, closeLowReact);
      var strengthLowZone = lane === "15"
        ? reactionUp15(idxReact, confirmBars, hiLowZone, atrBasis)
        : reactionUp5(idxReact, confirmBars, hiLowZone, atrBasis);
      if (finite(loLowZone) && finite(hiLowZone) && hiLowZone > loLowZone && hiLowZone <= shortEntry - entryGap && strengthLowZone >= minReaction) {
        shortRows.push({ lo: loLowZone, hi: hiLowZone, strength: strengthLowZone });
      }
    }
    if (longRows.length >= maxPerSide && shortRows.length >= maxPerSide) break;
    idxReact += 1;
  }
  return { longRows: longRows, shortRows: shortRows };
};

const clusterAt = (rows, seedIndex, side, tolerance) => {
  var seedCluster = rows[seedIndex];
  var edgeCluster = side === "LONG" ? seedCluster.lo : seedCluster.hi;
  var loCluster = 1000000000000;
  var hiCluster = -1000000000000;
  var touchesCluster = 0;
  var strengthCluster = 0;
  var idxCluster = 0;
  while (idxCluster < rows.length) {
    var rowCluster = rows[idxCluster];
    var edgeRowCluster = side === "LONG" ? rowCluster.lo : rowCluster.hi;
    if (Math.abs(edgeRowCluster - edgeCluster) <= tolerance) {
      touchesCluster += 1;
      loCluster = Math.min(loCluster, rowCluster.lo);
      hiCluster = Math.max(hiCluster, rowCluster.hi);
      strengthCluster = Math.max(strengthCluster, rowCluster.strength);
    }
    idxCluster += 1;
  }
  if (touchesCluster === 0) return null;
  return { lo: loCluster, hi: hiCluster, touches: touchesCluster, strength: strengthCluster };
};

const qualifyingClusters = (rows, side, tolerance, minTouches) => {
  var outClusters = [];
  var idxQual = 0;
  while (idxQual < rows.length) {
    var cQual = clusterAt(rows, idxQual, side, tolerance);
    if (cQual !== null && cQual.touches >= minTouches) {
      var duplicateQual = false;
      var jQual = 0;
      while (jQual < outClusters.length) {
        if (Math.abs(outClusters[jQual].lo - cQual.lo) < 0.125 && Math.abs(outClusters[jQual].hi - cQual.hi) < 0.125) {
          duplicateQual = true;
          break;
        }
        jQual += 1;
      }
      if (!duplicateQual) outClusters.push(cQual);
    }
    idxQual += 1;
  }
  return outClusters;
};

const canonicalizeZones = (first, second, fusionGap) => {
  var rowsCanon = [];
  var idxFirst = 0;
  while (idxFirst < first.length) {
    rowsCanon.push(first[idxFirst]);
    idxFirst += 1;
  }
  var idxSecond = 0;
  while (idxSecond < second.length) {
    rowsCanon.push(second[idxSecond]);
    idxSecond += 1;
  }
  rowsCanon.sort((a, b) => {
    if (a.lo !== b.lo) return a.lo - b.lo;
    if (a.hi !== b.hi) return a.hi - b.hi;
    return b.touches - a.touches;
  });
  if (rowsCanon.length === 0) return [];
  var outCanon = [];
  var curCanon = { lo: rowsCanon[0].lo, hi: rowsCanon[0].hi, touches: rowsCanon[0].touches, strength: rowsCanon[0].strength };
  var idxCanon = 1;
  while (idxCanon < rowsCanon.length) {
    var zCanon = rowsCanon[idxCanon];
    if (zCanon.lo <= curCanon.hi + fusionGap && zCanon.hi >= curCanon.lo - fusionGap) {
      curCanon.lo = Math.min(curCanon.lo, zCanon.lo);
      curCanon.hi = Math.max(curCanon.hi, zCanon.hi);
      curCanon.touches += zCanon.touches;
      curCanon.strength = Math.max(curCanon.strength, zCanon.strength);
    } else {
      outCanon.push(curCanon);
      curCanon = { lo: zCanon.lo, hi: zCanon.hi, touches: zCanon.touches, strength: zCanon.strength };
    }
    idxCanon += 1;
  }
  outCanon.push(curCanon);
  return outCanon;
};

const safeTargetFromZone = (zone, side, longDepth, shortDepth) => {
  var minInsideTarget = zone.lo + 0.25;
  var maxInsideTarget = zone.hi - 0.25;
  if (minInsideTarget > maxInsideTarget) return null;
  var depthTarget = side === "LONG" ? longDepth : shortDepth;
  var rawTarget = side === "LONG"
    ? zone.lo + (zone.hi - zone.lo) * depthTarget
    : zone.hi - (zone.hi - zone.lo) * depthTarget;
  var roundedTarget = side === "LONG" ? roundDownTick(rawTarget) : roundUpTick(rawTarget);
  return clampValue(roundedTarget, minInsideTarget, maxInsideTarget);
};

const selectCanonicalTargets = (side, entry, entryGap, zoneGap, zones, longDepth, shortDepth) => {
  if (!finite(entry)) return [];
  var eligibleTargets = [];
  var idxEligible = 0;
  while (idxEligible < zones.length) {
    var zoneEligible = zones[idxEligible];
    var validSideEligible = side === "LONG"
      ? zoneEligible.lo >= entry + entryGap
      : zoneEligible.hi <= entry - entryGap;
    if (validSideEligible) eligibleTargets.push(zoneEligible);
    idxEligible += 1;
  }
  eligibleTargets.sort((a, b) => {
    var da = side === "LONG" ? a.lo - entry : entry - a.hi;
    var db = side === "LONG" ? b.lo - entry : entry - b.hi;
    if (da !== db) return da - db;
    if (b.strength !== a.strength) return b.strength - a.strength;
    return b.touches - a.touches;
  });
  var outTargets = [];
  var boundaryTarget = entry;
  var requiredGapTarget = entryGap;
  var idxTarget = 0;
  while (idxTarget < eligibleTargets.length && outTargets.length < 3) {
    var zoneTarget = eligibleTargets[idxTarget];
    var distinctTarget = side === "LONG"
      ? zoneTarget.lo >= boundaryTarget + requiredGapTarget
      : zoneTarget.hi <= boundaryTarget - requiredGapTarget;
    if (distinctTarget) {
      var priceTarget = safeTargetFromZone(zoneTarget, side, longDepth, shortDepth);
      var profitSideTarget = side === "LONG" ? finite(priceTarget) && priceTarget > entry : finite(priceTarget) && priceTarget < entry;
      if (profitSideTarget) {
        outTargets.push({ lo: zoneTarget.lo, hi: zoneTarget.hi, target: priceTarget, touches: zoneTarget.touches, strength: zoneTarget.strength });
        boundaryTarget = side === "LONG" ? zoneTarget.hi : zoneTarget.lo;
        requiredGapTarget = zoneGap;
      }
    }
    idxTarget += 1;
  }
  return outTargets;
};

const bodyFraction = (i) => {
  var rangeBody = high(i) - low(i);
  if (rangeBody <= 0) return 0;
  return Math.abs(closeC(i) - openC(i)) / rangeBody;
};

const updateEntryState = (length, side, proof, atr5, state) => {
  var newBarState = length > state[7];
  if (state[7] === 0) state[7] = length;
  if (state[2] !== 0 && (state[2] !== side || !finite(proof) || !finite(state[3]) || Math.abs(proof - state[3]) >= 0.25)) {
    state[1] = "WAIT_PROOF";
    state[2] = 0;
    state[3] = null;
    state[4] = null;
    state[5] = null;
    state[6] = null;
  }
  if (newBarState) {
    if (state[1] === "WAIT_PROOF" && finite(proof)) {
      var crossedState = side === 1 ? closeC(1) > proof : closeC(1) < proof;
      if (crossedState && bodyFraction(1) >= 0.15) {
        state[2] = side;
        state[3] = proof;
        state[4] = side === 1 ? high(1) : low(1);
        state[5] = length;
        state[6] = state[4];
        state[1] = "WAIT_BREAK";
      }
    } else if (state[1] === "WAIT_BREAK" && state[5] !== null && length > state[5]) {
      state[4] = state[2] === 1 ? high(1) : low(1);
      state[5] = length;
      state[6] = state[4];
    }
    state[7] = length;
  }
  if (state[1] === "WAIT_BREAK" && state[5] !== null && length >= state[5]) {
    var brokeState = state[2] === 1 ? high(0) >= state[4] + 0.25 : low(0) <= state[4] - 0.25;
    if (brokeState) {
      state[6] = state[2] === 1 ? high(0) : low(0);
      state[1] = "BREAK";
      return;
    }
  } else if (state[1] === "BREAK") {
    var pushBreakState = Math.max(0.50, atr5 * 0.08);
    var recoilState = Math.max(0.50, atr5 * 0.20);
    var hardState = state[2] === 1 ? closeC(0) <= state[6] - recoilState : closeC(0) >= state[6] + recoilState;
    if (hardState) {
      state[1] = "WAIT_BREAK";
      state[6] = state[4];
    } else {
      var p1State = state[2] === 1 ? high(0) >= state[6] + pushBreakState : low(0) <= state[6] - pushBreakState;
      if (p1State) {
        state[6] = state[2] === 1 ? high(0) : low(0);
        state[1] = "PUSH_1";
      }
    }
  } else if (state[1] === "PUSH_1") {
    var pushSecondState = Math.max(0.50, atr5 * 0.08);
    var p2State = state[2] === 1 ? high(0) >= state[6] + pushSecondState : low(0) <= state[6] - pushSecondState;
    if (p2State) state[1] = "ENTRY_READY";
  }
};

const drawTargets = (rows, sideName) => {
  var idxDraw = 0;
  while (idxDraw < rows.length) {
    var nameDraw = sideName + " TP " + String(idxDraw + 1) + " BODY-ZONE";
    band.line(nameDraw, rows[idxDraw].target, "#2A76FF", 0, 2, true);
    idxDraw += 1;
  }
};

onTick = (length, _moment, _, ta, inputs) => {
  if (length < 100) return;

  if (inputs.showheartbeat) {
    plot.line("SLUMDAWG V2.0.5 ACTIVE", closeC(0), "#808080", 6, 0, 0, "slumdawg_v205_active");
  }

  var memoryRun = Math.max(2, Math.min(20, inputs.swingmemory));
  var pairRun = selectOuterPair(memoryRun, 320);
  var moveRun = updateCurrentMove(pairRun.pivots, runtimeState);
  var sideRun = moveRun;

  if ((pairRun.longEntry === null || pairRun.shortEntry === null) && inputs.showheartbeat) {
    band.line("SLUMDAWG BUILDING STRUCTURE", closeC(0), "#808080", 2, 1, true);
  }

  var atr15Run = mtf.atr(14, false);
  var atr5Run = atr5Simple(14);
  var basis15Run = finite(atr15Run) ? atr15Run : 5.0;
  var basis5Run = finite(atr5Run) ? atr5Run : 5.0;
  var tolerance15Run = Math.max(1.0, basis15Run * inputs.tptolerance);
  var tolerance5Run = Math.max(1.0, basis5Run * 0.22);
  var entryGapRun = Math.max(1.0, basis15Run * inputs.tpentrygap);
  var zoneGapRun = Math.max(1.0, basis15Run * inputs.tpzonegap);
  var fusionGapRun = Math.max(zoneGapRun, Math.max(1.0, basis15Run * inputs.tpfusion));
  var scan5Run = Math.min(600, Math.max(10, length - 4));

  var raw15Run = collectDirectionalReactions(
    "15", 320, pairRun.longEntry, pairRun.shortEntry, entryGapRun, 120,
    inputs.reactionbars, inputs.minreactionatr, basis15Run
  );
  var raw5Run = collectDirectionalReactions(
    "5", scan5Run, pairRun.longEntry, pairRun.shortEntry, entryGapRun, 180,
    inputs.reactionbars, inputs.minreactionatr, basis5Run
  );

  var long15Run = qualifyingClusters(raw15Run.longRows, "LONG", tolerance15Run, inputs.mintouches15);
  var short15Run = qualifyingClusters(raw15Run.shortRows, "SHORT", tolerance15Run, inputs.mintouches15);
  var long5Run = qualifyingClusters(raw5Run.longRows, "LONG", tolerance5Run, inputs.mintouches5);
  var short5Run = qualifyingClusters(raw5Run.shortRows, "SHORT", tolerance5Run, inputs.mintouches5);

  var longZonesRun = canonicalizeZones(long15Run, long5Run, fusionGapRun);
  var shortZonesRun = canonicalizeZones(short15Run, short5Run, fusionGapRun);

  var longTargetsRun = selectCanonicalTargets(
    "LONG", pairRun.longEntry, entryGapRun, fusionGapRun, longZonesRun,
    inputs.longdepth, inputs.shortdepth
  );
  var shortTargetsRun = selectCanonicalTargets(
    "SHORT", pairRun.shortEntry, entryGapRun, fusionGapRun, shortZonesRun,
    inputs.longdepth, inputs.shortdepth
  );

  if (inputs.showentries && pairRun.longEntry !== null) {
    band.line("LONG ENTRY ZONE", pairRun.longEntry, "#FFBE19", 0, 3, true);
    plot.line("SLUMDAWG LONG ENTRY", pairRun.longEntry, "#FFBE19", 7, 0, 0, "slumdawg_long_entry_v205");
  }
  if (inputs.showentries && pairRun.shortEntry !== null) {
    band.line("SHORT ENTRY ZONE", pairRun.shortEntry, "#FFBE19", 0, 3, true);
    plot.line("SLUMDAWG SHORT ENTRY", pairRun.shortEntry, "#FFBE19", 7, 0, 0, "slumdawg_short_entry_v205");
  }

  if (inputs.showtps) {
    drawTargets(longTargetsRun, "LONG");
    drawTargets(shortTargetsRun, "SHORT");
    if (longTargetsRun.length > 0 && longTargetsRun[0].target > pairRun.longEntry) plot.line("SLUMDAWG LONG TP1", longTargetsRun[0].target, "#2A76FF", 7, 0, 0, "slumdawg_long_tp1_v205");
    if (longTargetsRun.length > 1 && longTargetsRun[1].target > pairRun.longEntry) plot.line("SLUMDAWG LONG TP2", longTargetsRun[1].target, "#2A76FF", 7, 0, 0, "slumdawg_long_tp2_v205");
    if (longTargetsRun.length > 2 && longTargetsRun[2].target > pairRun.longEntry) plot.line("SLUMDAWG LONG TP3", longTargetsRun[2].target, "#2A76FF", 7, 0, 0, "slumdawg_long_tp3_v205");
    if (shortTargetsRun.length > 0 && shortTargetsRun[0].target < pairRun.shortEntry) plot.line("SLUMDAWG SHORT TP1", shortTargetsRun[0].target, "#2A76FF", 7, 0, 0, "slumdawg_short_tp1_v205");
    if (shortTargetsRun.length > 1 && shortTargetsRun[1].target < pairRun.shortEntry) plot.line("SLUMDAWG SHORT TP2", shortTargetsRun[1].target, "#2A76FF", 7, 0, 0, "slumdawg_short_tp2_v205");
    if (shortTargetsRun.length > 2 && shortTargetsRun[2].target < pairRun.shortEntry) plot.line("SLUMDAWG SHORT TP3", shortTargetsRun[2].target, "#2A76FF", 7, 0, 0, "slumdawg_short_tp3_v205");
  }

  var proofRun = null;
  if (sideRun === 1) proofRun = pairRun.longEntry;
  else if (sideRun === -1) proofRun = pairRun.shortEntry;

  if (sideRun !== 0 && finite(proofRun) && finite(atr5Run)) {
    updateEntryState(length, sideRun, proofRun, atr5Run, runtimeState);
  }
};
