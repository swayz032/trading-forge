import { describe, expect, it } from "vitest";
import {
  CINEMATIC_DURATION_MS,
  buildCompilerSceneModel,
  chooseRenderProfile,
  deriveCompilerIdentity,
  phaseAt,
} from "../../../../public/slumhouse/evidence-vault-compiler.js";

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
    expect(model.seal).toBe("SOURCE CAPTURED · BLUEPRINT NOT YET COMPILED");
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
    const compiled = structuredClone(sourceOnly);
    compiled.strategy.compilerView = {
      state: "compiled",
      receiptHash: "spec-hash",
      graphHash: "graph-hash",
      direction: "both",
      binding: {
        compiled: true,
        approximationUsed: false,
        spineBound: 1,
        spineTotal: 1,
        triggerBound: true,
        queueReasons: [],
      },
      chambers: emptyChambers.map((chamber) => chamber.key === "entry" ? {
        ...chamber,
        state: "verified",
        rules: [{
          id: "ENABLE_ENTRY:breakout#0",
          label: "close breaks opening range",
          type: "ENABLE_ENTRY",
          role: "trigger",
          origin: "explicit",
          evidence: "Enter only after a closing breakout.",
          span: { start: 24, end: 63 },
          expression: null,
        }],
      } : chamber.key === "stop" ? {
        ...chamber,
        state: "inferred",
        rules: [{
          id: "config:stop_loss",
          label: "Managed stop",
          type: "CONFIG",
          role: null,
          origin: "compiler_generated",
          evidence: null,
          span: null,
          expression: '{"type":"atr","multiplier":1.5}',
        }],
      } : chamber),
    };

    const model = buildCompilerSceneModel(compiled);

    expect(model.status).toBe("compiled");
    expect(model.seal).toBe("COMPILED BLUEPRINT · RECEIPT SEALED");
    expect(model.receiptHash).toBe("spec-hash");
    expect(model.chambers.find((chamber: any) => chamber.key === "entry")?.rules[0]?.evidence).toBe("Enter only after a closing breakout.");
    expect(model.chambers.find((chamber: any) => chamber.key === "stop")?.state).toBe("inferred");
  });
});

describe("compiler cinematic runtime policy", () => {
  it("runs a complete seven-second transformation on the animated profile", () => {
    expect(CINEMATIC_DURATION_MS).toBe(7000);
    expect(phaseAt(0)).toBe("source");
    expect(phaseAt(1600)).toBe("transcript");
    expect(phaseAt(3200)).toBe("storm");
    expect(phaseAt(5200)).toBe("assembly");
    expect(phaseAt(6500)).toBe("seal");
    expect(phaseAt(7000)).toBe("settled");
  });

  it("caps GPU pressure and keeps a truthful static view without WebGL or motion", () => {
    expect(chooseRenderProfile({
      webgl2: true,
      reducedMotion: false,
      devicePixelRatio: 3,
      width: 1920,
      hardwareConcurrency: 16,
    })).toEqual({ mode: "webgl", dpr: 1.75, particles: 4200, durationMs: 7000 });
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
});
