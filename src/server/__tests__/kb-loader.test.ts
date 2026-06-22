/**
 * KB Loader Tests — Scout Architecture Fix Pass 1 Branch C
 *
 * Verifies the KB injection layer in model-router.ts:
 *   1. Per-role KB cards are appended to the system prompt
 *   2. Few-shot examples are loaded only for opted-in roles
 *   3. taskContext.signalType filters few-shot examples
 *   4. 60-second TTL cache hit / miss
 *   5. New role configs (scout_auditor, dsl_quality_critic, transcript_extractor)
 *   6. Backwards-compatible: no taskContext arg still works
 *   7. Concurrent calls do not cause cache corruption
 *   8. Missing KB files degrade gracefully (no throw)
 *
 * fs reads are mocked so the tests don't depend on Branch B's KB authoring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("../index.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// fs is mocked to a virtual filesystem we control per-test. Each test
// configures `virtualFs` and the mock reads from there. This keeps
// tests isolated from Branch B's KB authoring cadence.
type VirtualFs = {
  files: Map<string, string>;
  dirs: Map<string, string[]>; // dir → list of filenames
};

const virtualFs: VirtualFs = {
  files: new Map(),
  dirs: new Map(),
};

vi.mock("fs", () => ({
  readFileSync: vi.fn((path: string) => {
    const normalized = path.replace(/\\/g, "/");
    for (const [k, v] of virtualFs.files.entries()) {
      const nk = k.replace(/\\/g, "/");
      if (normalized.endsWith(nk) || normalized === nk) {
        return v;
      }
    }
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  }),
  readdirSync: vi.fn((path: string) => {
    const normalized = path.replace(/\\/g, "/");
    for (const [k, v] of virtualFs.dirs.entries()) {
      const nk = k.replace(/\\/g, "/");
      if (normalized.endsWith(nk) || normalized === nk) {
        return v;
      }
    }
    throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  }),
}));

// Lazy import — must come AFTER vi.mock declarations
let mod: typeof import("../services/model-router.js");

beforeEach(async () => {
  virtualFs.files.clear();
  virtualFs.dirs.clear();
  // Reset module to clear in-memory caches between tests
  vi.resetModules();
  mod = await import("../services/model-router.js");
  mod.__clearPromptCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function setupBranchBFiles() {
  // Base prompts for the 6 cloud roles
  virtualFs.files.set(
    "src/agents/strategy-proposer.md",
    "# Strategy Proposer\nBase prompt for strategy_proposer.",
  );
  virtualFs.files.set(
    "src/agents/critic-evaluator.md",
    "# Critic Evaluator\nBase prompt for critic_evaluator.",
  );
  virtualFs.files.set(
    "src/agents/nightly-self-critique.md",
    "# Nightly Review\nBase prompt for nightly_review.",
  );
  virtualFs.files.set(
    "src/agents/scout-auditor.md",
    "# Scout Auditor\nBase prompt for scout_auditor.",
  );
  virtualFs.files.set(
    "src/agents/dsl-quality-critic.md",
    "# DSL Quality Critic\nBase prompt for dsl_quality_critic.",
  );
  virtualFs.files.set(
    "src/agents/transcript-extractor.md",
    "# Transcript Extractor\nBase prompt for transcript_extractor.",
  );

  // KB cards
  virtualFs.files.set(
    "src/agents/kb/strategy-schema-snapshot.json",
    JSON.stringify(
      { properties: { name: {}, symbol: {} }, required: ["name"], title: "StrategyDSL" },
      null,
      2,
    ),
  );
  virtualFs.files.set(
    "src/agents/kb/indicator-catalog.md",
    "# Indicators\nATR, EMA, VWAP, RSI",
  );
  virtualFs.files.set(
    "src/agents/kb/regime-taxonomy.md",
    "# Regime\nTRENDING / RANGE_BOUND / HIGH_VOL / LOW_VOL",
  );
  virtualFs.files.set(
    "src/agents/kb/prop-firm-rules-summary.md",
    "# Prop Firms\nTopstep / Apex / MFFU / TPT / FFN / Alpha / Tradeify / Earn2Trade",
  );
  virtualFs.files.set(
    "src/agents/kb/anti-pattern-catalog.md",
    "# Anti-Patterns\nTight overfitting, regime fragility, look-ahead bias.",
  );
}

function setupFewShot(role: string, examples: { name: string; content: string }[]) {
  const dirName = role.replace(/_/g, "-");
  const dirPath = `src/agents/kb/few-shot/${dirName}`;
  virtualFs.dirs.set(
    dirPath,
    examples.map((e) => e.name),
  );
  for (const ex of examples) {
    virtualFs.files.set(`${dirPath}/${ex.name}`, ex.content);
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("KB injection — base prompt + KB cards", () => {
  it("loadSystemPrompt('strategy_proposer') returns prompt + KB cards", () => {
    setupBranchBFiles();
    const out = mod.loadSystemPrompt("strategy_proposer");

    expect(out).toContain("# Strategy Proposer");
    // strategy_proposer manifest = schema-snapshot, indicator-catalog,
    // regime-taxonomy, anti-pattern-catalog
    expect(out).toContain("## KB: strategy-schema-snapshot.json");
    expect(out).toContain("## KB: indicator-catalog.md");
    expect(out).toContain("## KB: regime-taxonomy.md");
    expect(out).toContain("## KB: anti-pattern-catalog.md");
  });

  it("KB cards are appended in declared manifest order", () => {
    setupBranchBFiles();
    const out = mod.loadSystemPrompt("strategy_proposer");
    const idxSchema = out.indexOf("## KB: strategy-schema-snapshot.json");
    const idxIndicator = out.indexOf("## KB: indicator-catalog.md");
    const idxRegime = out.indexOf("## KB: regime-taxonomy.md");
    const idxAnti = out.indexOf("## KB: anti-pattern-catalog.md");

    expect(idxSchema).toBeGreaterThan(-1);
    expect(idxIndicator).toBeGreaterThan(idxSchema);
    expect(idxRegime).toBeGreaterThan(idxIndicator);
    expect(idxAnti).toBeGreaterThan(idxRegime);
  });

  it("missing KB file → graceful degradation, no throw", () => {
    // Only set the base prompt and 1 of 4 KB cards
    virtualFs.files.set(
      "src/agents/strategy-proposer.md",
      "Base prompt for strategy_proposer",
    );
    virtualFs.files.set(
      "src/agents/kb/indicator-catalog.md",
      "# Indicators\nATR EMA VWAP",
    );

    // Should not throw — missing schema snapshot, regime, anti-pattern
    let out: string | null = null;
    expect(() => {
      out = mod.loadSystemPrompt("strategy_proposer");
    }).not.toThrow();
    expect(out).toBeTruthy();
    expect(out).toContain("Base prompt for strategy_proposer");
    expect(out).toContain("## KB: indicator-catalog.md");
    // Missing cards are not present
    expect(out).not.toContain("## KB: strategy-schema-snapshot.json");
    expect(out).not.toContain("## KB: regime-taxonomy.md");
    expect(out).not.toContain("## KB: anti-pattern-catalog.md");
  });
});

describe("Few-shot examples", () => {
  it("loads few-shot for strategy_proposer (opted in)", () => {
    setupBranchBFiles();
    setupFewShot("strategy-proposer", [
      {
        name: "001-trend-mes.json",
        content: JSON.stringify({
          input: "MES on trend day",
          output: { name: "trend_mes", direction: "long" },
        }),
      },
      {
        name: "002-fade-mnq.json",
        content: JSON.stringify({
          input: "MNQ range fade",
          output: { name: "fade_mnq", direction: "both" },
        }),
      },
    ]);

    const out = mod.loadSystemPrompt("strategy_proposer");
    expect(out).toContain("## Few-shot examples");
    expect(out).toContain("INPUT: MES on trend day");
    expect(out).toContain("trend_mes");
    expect(out).toContain("INPUT: MNQ range fade");
  });

  it("does NOT load few-shot for critic_evaluator (not opted in)", () => {
    setupBranchBFiles();
    setupFewShot("critic-evaluator", [
      {
        name: "001-fragile.json",
        content: JSON.stringify({ input: "x", output: { score: 3 } }),
      },
    ]);

    const out = mod.loadSystemPrompt("critic_evaluator");
    expect(out).not.toContain("## Few-shot examples");
    expect(out).not.toContain("INPUT: x");
  });

  it("filters few-shot examples by taskContext.signalType when set", () => {
    setupBranchBFiles();
    setupFewShot("strategy-proposer", [
      {
        name: "001-strategy.json",
        content: JSON.stringify({
          signalType: "strategy_candidate",
          input: "STRATEGY input",
          output: { kind: "strategy" },
        }),
      },
      {
        name: "002-news.json",
        content: JSON.stringify({
          signalType: "market_news_intel",
          input: "NEWS input",
          output: { kind: "news" },
        }),
      },
    ]);

    const out = mod.loadSystemPrompt("strategy_proposer", {
      signalType: "strategy_candidate",
    });
    expect(out).toContain("STRATEGY input");
    expect(out).not.toContain("NEWS input");
  });

  it("falls back to all examples when signalType filter matches none", () => {
    setupBranchBFiles();
    setupFewShot("strategy-proposer", [
      {
        name: "001.json",
        content: JSON.stringify({
          input: "X",
          output: { kind: "x" },
          // no signalType / tags
        }),
      },
    ]);

    const out = mod.loadSystemPrompt("strategy_proposer", {
      signalType: "market_news_intel",
    });
    // Filter matched zero — fallback returns all examples
    expect(out).toContain("INPUT: X");
  });
});

describe("60-second TTL cache", () => {
  it("cache hit on second call within TTL", async () => {
    setupBranchBFiles();
    const fs = await import("fs");
    const readFileSyncMock = vi.mocked(fs.readFileSync);

    // Prime cache
    const out1 = mod.loadSystemPrompt("scout_auditor");
    const reads1 = readFileSyncMock.mock.calls.length;

    // Second call inside 60s window — should not hit fs
    const out2 = mod.loadSystemPrompt("scout_auditor");
    const reads2 = readFileSyncMock.mock.calls.length;

    expect(out1).toBe(out2);
    expect(reads2).toBe(reads1); // no new fs reads
  });

  it("cache miss after 60s TTL — fs is read again", async () => {
    setupBranchBFiles();
    const fs = await import("fs");
    const readFileSyncMock = vi.mocked(fs.readFileSync);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

    mod.loadSystemPrompt("scout_auditor");
    const reads1 = readFileSyncMock.mock.calls.length;

    // Advance 61 seconds
    vi.setSystemTime(new Date("2026-05-04T12:01:01Z"));
    mod.loadSystemPrompt("scout_auditor");
    const reads2 = readFileSyncMock.mock.calls.length;

    expect(reads2).toBeGreaterThan(reads1);
  });
});

describe("New role configs", () => {
  it("scout_auditor config exists with deepseek-r1:14b fallback", () => {
    const cfg = mod.MODEL_CONFIGS.scout_auditor;
    expect(cfg).toBeTruthy();
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-5-mini");
    expect(cfg.responseFormat).toBe("json");
    expect(cfg.maxTokens).toBe(256);
    expect(cfg.fallback?.model).toBe("deepseek-r1:14b");
  });

  it("dsl_quality_critic config exists with deepseek-r1:14b fallback", () => {
    const cfg = mod.MODEL_CONFIGS.dsl_quality_critic;
    expect(cfg).toBeTruthy();
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-5-mini");
    expect(cfg.responseFormat).toBe("json");
    expect(cfg.maxTokens).toBe(1024);
    expect(cfg.fallback?.model).toBe("deepseek-r1:14b");
  });

  it("transcript_extractor config is Ollama-primary (gemma4) with gpt-5-mini cloud fallback", () => {
    // Wave 26 Pass A (2026-05-24): transcript_extractor swapped to Ollama-first
    // (gemma4:e2b local); gpt-5-mini is now the CLOUD FALLBACK.
    // OLLAMA_HEALTHY defaults true at module load → provider resolves to "ollama".
    // Wave 26 Pass I (v11): maxTokens 8192 (was 4096 pre-Pass-A).
    const cfg = mod.MODEL_CONFIGS.transcript_extractor;
    expect(cfg).toBeTruthy();
    expect(cfg.provider).toBe("ollama");
    expect(cfg.model).toBe("gemma4:e2b");
    expect(cfg.responseFormat).toBe("json");
    expect(cfg.maxTokens).toBe(8192);
    expect(cfg.fallback?.provider).toBe("openai");
    expect(cfg.fallback?.model).toBe("gpt-5-mini");
  });

  it("each new role has a systemPromptPath that resolves correctly", () => {
    expect(mod.MODEL_CONFIGS.scout_auditor.systemPromptPath).toBe(
      "src/agents/scout-auditor.md",
    );
    expect(mod.MODEL_CONFIGS.dsl_quality_critic.systemPromptPath).toBe(
      "src/agents/dsl-quality-critic.md",
    );
    expect(mod.MODEL_CONFIGS.transcript_extractor.systemPromptPath).toBe(
      "src/agents/transcript-extractor-minimal.md",
    );
  });
});

describe("KB_MANIFEST coverage", () => {
  it("has an entry for every ModelRole", () => {
    const roles = Object.keys(mod.MODEL_CONFIGS);
    for (const role of roles) {
      expect(mod.KB_MANIFEST).toHaveProperty(role);
    }
  });

  it("scout_auditor manifest is empty (binary accept/reject, no schemas)", () => {
    expect(mod.KB_MANIFEST.scout_auditor).toEqual([]);
  });

  it("strategy_proposer manifest contains schema snapshot first", () => {
    expect(mod.KB_MANIFEST.strategy_proposer[0]).toBe(
      "kb/strategy-schema-snapshot.json",
    );
  });
});

describe("Schema snapshot integration", () => {
  it("loads as valid JSON when present in KB", () => {
    setupBranchBFiles();
    const out = mod.loadSystemPrompt("strategy_proposer");
    const sectionStart = out.indexOf("## KB: strategy-schema-snapshot.json");
    expect(sectionStart).toBeGreaterThan(-1);
    // Extract the embedded JSON section (everything after the header until
    // the next ## KB or ## Few-shot or end-of-string)
    const after = out.slice(sectionStart);
    const jsonStart = after.indexOf("{");
    expect(jsonStart).toBeGreaterThan(-1);
    // The mock payload is small enough that JSON.parse should succeed on
    // the first { ... } block in the section.
    const closingBrace = after.lastIndexOf("}");
    const jsonStr = after.slice(jsonStart, closingBrace + 1);
    // Coarse check — should at least be parseable to something
    expect(() => JSON.parse(jsonStr)).not.toThrow();
  });
});

describe("Backwards compatibility", () => {
  it("loadSystemPrompt(role) without taskContext still works", () => {
    setupBranchBFiles();
    const out = mod.loadSystemPrompt("nightly_review");
    expect(out).toContain("# Nightly Review");
    // nightly_review manifest includes anti-pattern-catalog
    expect(out).toContain("## KB: anti-pattern-catalog.md");
  });

  it("PromptTaskContext is optional (undefined works)", () => {
    setupBranchBFiles();
    const a = mod.loadSystemPrompt("strategy_proposer");
    const b = mod.loadSystemPrompt("strategy_proposer", undefined);
    expect(a).toBe(b);
  });

  it("different taskContext values produce distinct cache entries", () => {
    setupBranchBFiles();
    setupFewShot("strategy-proposer", [
      {
        name: "001.json",
        content: JSON.stringify({
          signalType: "strategy_candidate",
          input: "STRATEGY",
          output: { x: 1 },
        }),
      },
      {
        name: "002.json",
        content: JSON.stringify({
          signalType: "market_news_intel",
          input: "NEWS",
          output: { x: 2 },
        }),
      },
    ]);

    const a = mod.loadSystemPrompt("strategy_proposer", {
      signalType: "strategy_candidate",
    });
    const b = mod.loadSystemPrompt("strategy_proposer", {
      signalType: "market_news_intel",
    });
    // Different filters → different rendered few-shot sections
    expect(a).not.toBe(b);
    expect(a).toContain("INPUT: STRATEGY");
    expect(a).not.toContain("INPUT: NEWS");
    expect(b).toContain("INPUT: NEWS");
    expect(b).not.toContain("INPUT: STRATEGY");
  });
});

describe("Cache integrity under concurrent calls", () => {
  it("concurrent calls return identical content (no corruption)", async () => {
    setupBranchBFiles();
    const promises = Array.from({ length: 10 }, () =>
      Promise.resolve(mod.loadSystemPrompt("strategy_proposer")),
    );
    const results = await Promise.all(promises);
    const first = results[0];
    for (const r of results) {
      expect(r).toBe(first);
    }
  });
});

describe("Roles with empty KB manifest", () => {
  it("returns just the base prompt when KB_MANIFEST is empty", () => {
    setupBranchBFiles();
    const out = mod.loadSystemPrompt("scout_auditor");
    // scout_auditor manifest is [] — only base prompt should be present,
    // no ## KB: sections
    expect(out).toContain("# Scout Auditor");
    expect(out).not.toContain("## KB:");
  });
});

describe("FEWSHOT_ROLES coverage", () => {
  it("contains the four expected opt-in roles", () => {
    expect(mod.FEWSHOT_ROLES.has("strategy_proposer")).toBe(true);
    expect(mod.FEWSHOT_ROLES.has("scout_auditor")).toBe(true);
    expect(mod.FEWSHOT_ROLES.has("dsl_quality_critic")).toBe(true);
    expect(mod.FEWSHOT_ROLES.has("transcript_extractor")).toBe(true);
  });

  it("does NOT contain critic_evaluator, nightly_review, or local-only roles", () => {
    expect(mod.FEWSHOT_ROLES.has("critic_evaluator")).toBe(false);
    expect(mod.FEWSHOT_ROLES.has("nightly_review")).toBe(false);
    expect(mod.FEWSHOT_ROLES.has("fast_critique")).toBe(false);
    expect(mod.FEWSHOT_ROLES.has("dsl_writer")).toBe(false);
    expect(mod.FEWSHOT_ROLES.has("embedder")).toBe(false);
  });
});
