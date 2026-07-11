// scripts/soak/soak-verdict.cjs — PURE verdict engine. No I/O, no Date.now(), no imports.
// Deterministic in → deterministic out. This is the doer≠grader math surface.
"use strict";

const MB = 1024 * 1024;

// Frozen thresholds — pre-registered BEFORE the first graded night. Any change is a
// versioned, dated event (anti-goalpost). Nights < calibrationNights are UNGRADED.
const THRESHOLDS_V1 = Object.freeze({
  version: "soak_thresholds_v1",
  memGreen30dMb: 1024,   // projected <1 GB / 30d → GREEN
  memRed30dMb: 4096,     // projected >4 GB / 30d → RED   (operator risk dial)
  diskGreenDays: 30,
  diskRedDays: 14,       // <14 days headroom → RED (can't survive a 2-week vacation)
  heartbeatGapMs: 120000,
  calibrationNights: 14,
});

function linearSlopePerHour(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return { slopeMbPerHr: 0, ciHalfWidth: Infinity };
  const n = samples.length;
  const xs = samples.map(s => s.tMs / 3600000); // hours
  const ys = samples.map(s => s.valueMb);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return { slopeMbPerHr: 0, ciHalfWidth: Infinity };
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) { const yhat = intercept + slope * xs[i]; sse += (ys[i] - yhat) ** 2; }
  const seSlope = n > 2 ? Math.sqrt((sse / (n - 2)) / sxx) : Infinity;
  return { slopeMbPerHr: slope, ciHalfWidth: 1.96 * seSlope }; // ~95% CI half-width
}

function projectGrowthMb(slopeMbPerHr, hours) { return slopeMbPerHr * hours; }

function gradeMemory({ slopeMbPerHr, ciHalfWidth, noiseFloorMbPerHr }) {
  // Only grade if the slope is confidently above the calibrated noise floor.
  const confidentlyRising = (slopeMbPerHr - ciHalfWidth) > noiseFloorMbPerHr;
  if (!confidentlyRising) return "GREEN"; // indistinguishable from flat
  const proj30d = projectGrowthMb(slopeMbPerHr, 720);
  if (proj30d > THRESHOLDS_V1.memRed30dMb) return "RED";
  if (proj30d < THRESHOLDS_V1.memGreen30dMb) return "GREEN";
  return "AMBER";
}

function gradeDisk({ freeBytesStart, freeBytesEnd, windowHours }) {
  const lostBytes = freeBytesStart - freeBytesEnd;
  if (lostBytes <= 0) return { verdict: "GREEN", daysToFull: Infinity };
  const bytesPerHr = lostBytes / windowHours;
  const daysToFull = (freeBytesEnd / bytesPerHr) / 24;
  let verdict = "AMBER";
  if (daysToFull >= THRESHOLDS_V1.diskGreenDays) verdict = "GREEN";
  else if (daysToFull < THRESHOLDS_V1.diskRedDays) verdict = "RED";
  return { verdict, daysToFull };
}

function gradeVram(vramFloorSeriesMb) {
  if (!Array.isArray(vramFloorSeriesMb) || vramFloorSeriesMb.length === 0) return "UNAVAILABLE";
  const first = vramFloorSeriesMb[0];
  const last = vramFloorSeriesMb[vramFloorSeriesMb.length - 1];
  // Orphan-VRAM-wedge: floor grew by >256MB AND >50% over the window with no return.
  if (last - first > 256 && last > first * 1.5) return "RED";
  return "GREEN";
}

function gradeRestarts(pidSeries) {
  for (let i = 1; i < pidSeries.length; i++) {
    if (pidSeries[i].pid !== pidSeries[i - 1].pid || pidSeries[i].startMs !== pidSeries[i - 1].startMs) return "RED";
  }
  return "GREEN";
}

function gradeHeartbeat(heartbeatSeries) {
  for (let i = 1; i < heartbeatSeries.length; i++) {
    const a = heartbeatSeries[i - 1], b = heartbeatSeries[i];
    if (!a.ok && !b.ok && (b.tMs - a.tMs) > THRESHOLDS_V1.heartbeatGapMs) return "RED";
  }
  return "GREEN";
}

function computeNightVerdict({ metricGrades, nightIndex, invalidating }) {
  if (invalidating) return "INVALID";
  if (nightIndex < THRESHOLDS_V1.calibrationNights) return "CALIBRATING";
  if (Object.values(metricGrades).includes("RED")) return "RED";
  return "GREEN";
}

module.exports = {
  THRESHOLDS_V1, MB,
  linearSlopePerHour, projectGrowthMb,
  gradeMemory, gradeDisk, gradeVram, gradeRestarts, gradeHeartbeat, computeNightVerdict,
};
