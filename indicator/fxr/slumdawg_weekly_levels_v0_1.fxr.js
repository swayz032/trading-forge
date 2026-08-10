//@version=1
// Slumdawg FX Replay — Weekly Key Levels v0.1
// PLATFORM PARITY / RESEARCH ONLY.
// Uses FX Replay native completed Weekly candles through the documented MTF API.

init = () => {
  indicator({ onMainPanel: true, format: "inherit" });
  input.bool("Show PWH / PWL", true, "showlevels");
  mtf.timeframe("1W");
};

onTick = (length, _moment, _, ta, inputs) => {
  if (!inputs.showlevels || length < 2) return;

  // smooth=false => stepped / completed higher-timeframe values.
  const pwh = mtf.high(1, false);
  const pwl = mtf.low(1, false);

  if (typeof pwh === "number" && isFinite(pwh)) {
    band.line("PWH", pwh, "#5B52E6", 0, 2, true);
  }
  if (typeof pwl === "number" && isFinite(pwl)) {
    band.line("PWL", pwl, "#5B52E6", 0, 2, true);
  }
};
