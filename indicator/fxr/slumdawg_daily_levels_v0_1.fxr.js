//@version=1
// Slumdawg FX Replay — Daily Key Levels v0.1
// PLATFORM PARITY / RESEARCH ONLY.
// Uses FX Replay native completed Daily candles through the documented MTF API.

init = () => {
  indicator({ onMainPanel: true, format: "inherit" });
  input.bool("Show PDH / PDL", true, "showlevels");
  mtf.timeframe("1D");
};

onTick = (length, _moment, _, ta, inputs) => {
  if (!inputs.showlevels || length < 2) return;

  // smooth=false => stepped / completed higher-timeframe values.
  const pdh = mtf.high(1, false);
  const pdl = mtf.low(1, false);

  if (typeof pdh === "number" && isFinite(pdh)) {
    band.line("PDH", pdh, "#2370FF", 0, 2, true);
  }
  if (typeof pdl === "number" && isFinite(pdl)) {
    band.line("PDL", pdl, "#2370FF", 0, 2, true);
  }
};
