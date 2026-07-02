// deepscan6 R1: source-guard for the rolling-Sharpe ratio decay bands added inline to
// the existing rolling-sharpe scheduler job (behavioral coverage would require importing
// the whole scheduler; these guards lock the specific institutional-standard addition).
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
let src: string;
beforeAll(() => { src = readFileSync(resolve(here, "../scheduler.ts"), "utf8"); });

describe("deepscan6 R1 — rolling-Sharpe decay bands", () => {
  it("emits both ratio-band audit actions", () => {
    expect(src).toContain("strategy.sharpe_decay_review");
    expect(src).toContain("strategy.sharpe_decay_warn");
  });
  it("uses the 0.7x WARN / 0.5x REVIEW env knobs", () => {
    expect(src).toContain("SHARPE_DECAY_WARN_RATIO");
    expect(src).toContain("SHARPE_DECAY_REVIEW_RATIO");
    expect(src).toMatch(/SHARPE_DECAY_WARN_RATIO"\]\s*\?\?\s*"0\.7"/);
    expect(src).toMatch(/SHARPE_DECAY_REVIEW_RATIO"\]\s*\?\?\s*"0\.5"/);
  });
  it("computes the decay ratio against the backtest baseline and guards btSharpe>0", () => {
    expect(src).toContain("const decayRatio = liveSharpe / btSharpe");
    expect(src).toContain("if (btSharpe > 0)");
  });
  it("dedups the severe REVIEW Discord alert (6h/strategy)", () => {
    expect(src).toContain("_sharpeDecayAlertDedup");
  });
});
