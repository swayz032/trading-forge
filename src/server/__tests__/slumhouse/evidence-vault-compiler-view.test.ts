import { describe, expect, it } from "vitest";
import {
  CINEMATIC_DURATION_MS,
  STRATEGY_SLIDE_DURATION_MS,
  buildCompilerSceneModel,
  chooseRenderProfile,
  deriveCompilerIdentity,
  phaseAt,
  strategySlideAt,
} from "../../../../public/slumhouse/evidence-vault-compiler.js";
import * as compilerViewModule from "../../../../public/slumhouse/evidence-vault-compiler.js";

const emptyChambers = ["context", "setup", "entry", "stop", "exit", "sizing", "filters"].map((key) => ({
  key,
  label: key[0]?.toUpperCase() + key.slice(1),
  state: "unbound",
  rules: [],
}));

const sourceOnly: any = {
  strategy: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Opening Heist Atlas",
    symbol: "MES",
    timeframe: "5m",
    lifecycleState: "CANDIDATE",
    sourceVideoId: "dQw4w9WgXcQ",
    sourceTitle: "Opening Range Model",
    transcriptStatus: "available",
    compilerView: {
      state: "uncompiled",
      receiptHash: null,
      graphHash: null,
      direction: null,
      binding: null,
      chambers: emptyChambers,
    },
  },
  source: {
    videoId: "dQw4w9WgXcQ",
    title: "Opening Range Model",
    channel: "Real Trader",
    transcriptStatus: "available",
    transcriptChars: 28975,
    transcriptSha256: "a".repeat(64),
    transcript: "Mark the opening range. Enter only after a closing breakout.",
  },
};

function compiledInput() {
  const compiled = structuredClone(sourceOnly);
  compiled.strategy.compilerView = {
    state: "compiled",
    receiptHash: "spec-hash",
    graphHash: "graph-hash",
    direction: "long",
    binding: {
      compiled: true,
      approximationUsed: false,
      spineBound: 1,
      spineTotal: 1,
      triggerBound: true,
      queueReasons: [],
    },
    chambers: emptyChambers.map((chamber) => ({
      ...chamber,
      state: "verified",
      rules: chamber.key === "context" ? [
        { id: "context-1", label: "New York morning session", type: "WAIT_SESSION", origin: "explicit" },
        { id: "context-2", label: "Bullish market structure", type: "WAIT_STRUCTURE", origin: "explicit" },
      ] : chamber.key === "setup" ? [
        { id: "setup-1", label: "Price accepts above value", type: "WAIT_STRUCTURE", origin: "explicit" },
      ] : chamber.key === "entry" ? [
        { id: "entry-1", label: "Buy the first pullback", type: "ENABLE_ENTRY", origin: "explicit", evidence: "Enter only after a closing breakout.", span: { start: 24, end: 63 } },
      ] : chamber.key === "stop" ? [
        { id: "stop-1", label: "Managed stop", type: "CONFIG", origin: "compiler_generated", expression: '{"type":"atr","multiplier":1.5}' },
      ] : chamber.key === "sizing" ? [
        { id: "size-1", label: "Position sizing", type: "CONFIG", origin: "compiler_generated", expression: '{"max_risk_pct_per_trade":0.02}' },
      ] : chamber.key === "exit" ? [
        { id: "exit-1", label: "Exit parameters", type: "CONFIG", origin: "compiler_generated", expression: '{"style":"c"}' },
      ] : chamber.key === "filters" ? [
        { id: "filter-1", label: "Skip major news", type: "FILTER", origin: "explicit" },
      ] : [],
    })),
  };
  return compiled;
}

describe("Media Vault compiler scene model", () => {
  it("derives a stable per-video identity without changing semantic truth colors", () => {
    const first = deriveCompilerIdentity("dQw4w9WgXcQ");
    const second = deriveCompilerIdentity("dQw4w9WgXcQ");
    const other = deriveCompilerIdentity("abcdefghijk");

    expect(first).toEqual(second);
    expect(first).not.toEqual(other);
    expect(first.primary).toMatch(/^hsl\(\d+ 7\d% 5\d%\)$/);
    expect(first.secondary).toMatch(/^hsl\(\d+ 8\d% 6\d%\)$/);
    expect(first.semantic).toEqual({
      verified: "#a3ff12",
      inferred: "#ffb84d",
      refused: "#ff6363",
      unbound: "#7d8791",
    });
  });

  it("builds an impressive source-only state without inventing compiled rules", () => {
    const model = buildCompilerSceneModel(sourceOnly);

    expect(model.status).toBe("uncompiled");
    expect(model.seal).toBe("SOURCE SECURED - TRADING RULES AWAITING COMPILATION");
    expect(model.source).toMatchObject({
      videoId: "dQw4w9WgXcQ",
      title: "Opening Range Model",
      transcriptChars: 28975,
      transcriptSha256: "a".repeat(64),
    });
    expect(model.chambers.every((chamber: any) => chamber.state === "unbound")).toBe(true);
    expect(model.chambers.every((chamber: any) => chamber.rules.length === 0)).toBe(true);
    expect(JSON.stringify(model)).not.toMatch(/entry_long|stop_loss|profit_target/i);
  });

  it("preserves compiled receipt truth and labels inferred chambers distinctly", () => {
    const model = buildCompilerSceneModel(compiledInput());

    expect(model.status).toBe("compiled");
    expect(model.receiptHash).toBe("spec-hash");
    expect(model.chambers.find((chamber: any) => chamber.key === "entry")?.rules[0]?.evidence).toBe("Enter only after a closing breakout.");
    expect(model.chambers.find((chamber: any) => chamber.key === "stop")?.state).toBe("verified");
  });

  it("never presents a stale compiler receipt as verified green", () => {
    const renderCompilerViewMarkup = (compilerViewModule as any).renderCompilerViewMarkup;
    const stale = compiledInput();
    stale.strategy.compilerView.state = "stale";
    const html = renderCompilerViewMarkup(buildCompilerSceneModel(stale));

    expect(html).toContain('class="compiler-stage is-stale"');
    expect(html).toContain('class="compiler-state is-stale"');
    expect(html).toContain("LAST RECEIPT STALE");
    expect(html).toContain("compiler-seal");
  });

  it("maps persisted chambers into five simple trader-facing groups without inventing rules", () => {
    const buildStrategyCardGroups = (compilerViewModule as any).buildStrategyCardGroups;
    expect(typeof buildStrategyCardGroups).toBe("function");

    const groups = buildStrategyCardGroups(buildCompilerSceneModel(compiledInput()));
    expect(groups.map((group: any) => [group.key, group.label])).toEqual([
      ["trade_when", "Trade When"],
      ["enter", "Enter"],
      ["protect", "Protect"],
      ["manage", "Manage"],
      ["avoid", "Avoid"],
    ]);
    expect(groups[0].rules.map((rule: any) => rule.label)).toEqual([
      "New York morning session",
      "Bullish market structure",
    ]);
    expect(groups[0].additionalCount).toBe(1);
    expect(groups[1]).toMatchObject({ direction: "long", additionalCount: 0 });
    expect(groups[2].rules.map((rule: any) => rule.label)).toEqual(["Managed stop", "Position sizing"]);
    expect(groups[4].rules[0].label).toBe("Skip major news");

    const dormant = buildStrategyCardGroups(buildCompilerSceneModel(sourceOnly));
    expect(dormant.every((group: any) => group.rules.length === 0 && group.additionalCount === 0)).toBe(true);
  });

  it("renders one full-stage cinema with a single strategy-rules slideshow", () => {
    const renderCompilerViewMarkup = (compilerViewModule as any).renderCompilerViewMarkup;
    expect(typeof renderCompilerViewMarkup).toBe("function");

    const html = renderCompilerViewMarkup(buildCompilerSceneModel(sourceOnly));
    expect(html).toContain("compiler-luxury-cinema-v1.webp");
    expect(html.match(/class="compiler-strategy-card/g)).toHaveLength(1);
    expect(html.match(/class="compiler-slide-deck"/g)).toHaveLength(1);
    expect(html.match(/class="compiler-rule-slide/g)).toHaveLength(5);
    expect(html.match(/class="compiler-rule-slide is-active/g)).toHaveLength(1);
    expect(html.match(/data-compiler-slide="/g)).toHaveLength(5);
    expect(html).toContain("Trade When");
    expect(html).toContain("Enter");
    expect(html).toContain("Protect");
    expect(html).toContain("Manage");
    expect(html).toContain("Avoid");
    expect(html).toContain("Technical Receipt");
    expect(html).toContain("data-compiler-receipt hidden");
    expect(html).not.toContain("compiler-identity");
    expect(html).not.toContain("compiler-timeline");
    expect(html).not.toContain("<span>Rupture</span>");
    expect(html).not.toContain("compiler-machine");
    expect(html).not.toContain("compiler-strategy-group");
    expect(html).not.toContain("compiler-rule-plan");
  });
});

describe("compiler cinematic runtime policy", () => {
  it("keeps renderer initialization failures on the settled static fallback path", () => {
    const source = String(compilerViewModule.mountCompilerView);
    expect(source).toContain("catch (error)");
    expect(source).toContain('stage.classList.add("is-webgl-fallback")');
    expect(source).toContain("storm?.destroy()");
    expect(source).toContain("settle()");
  });

  it("runs a complete seven-second Category 5 transformation on the animated profile", () => {
    expect(CINEMATIC_DURATION_MS).toBe(7000);
    expect(phaseAt(0)).toBe("source");
    expect(phaseAt(1200)).toBe("rupture");
    expect(phaseAt(2500)).toBe("vortex");
    expect(phaseAt(5200)).toBe("compression");
    expect(phaseAt(6200)).toBe("shockwave");
    expect(phaseAt(7000)).toBe("settled");
  });

  it("adapts storm density while preserving a truthful static fallback", () => {
    expect(chooseRenderProfile({
      webgl2: true,
      reducedMotion: false,
      devicePixelRatio: 3,
      width: 1920,
      hardwareConcurrency: 16,
    })).toEqual({ mode: "webgl", dpr: 1.75, particles: 14000, durationMs: 7000 });
    expect(chooseRenderProfile({
      webgl2: false,
      reducedMotion: false,
      devicePixelRatio: 2,
      width: 1440,
      hardwareConcurrency: 8,
    })).toEqual({ mode: "static", dpr: 1, particles: 0, durationMs: 0 });
    expect(chooseRenderProfile({
      webgl2: true,
      reducedMotion: true,
      devicePixelRatio: 2,
      width: 1440,
      hardwareConcurrency: 8,
    })).toEqual({ mode: "static", dpr: 1, particles: 0, durationMs: 0 });
  });

  it("advances the five strategy chapters on a deterministic slideshow clock", () => {
    expect(STRATEGY_SLIDE_DURATION_MS).toBe(4200);
    expect(strategySlideAt(0)).toBe(0);
    expect(strategySlideAt(4199)).toBe(0);
    expect(strategySlideAt(4200)).toBe(1);
    expect(strategySlideAt(16800)).toBe(4);
    expect(strategySlideAt(21000)).toBe(0);
  });
});
