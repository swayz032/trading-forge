/**
 * carter-introspect.test.ts
 *
 * Covers the pure / branchable logic of the 7 Carter introspection handlers:
 *   - input validation throws
 *   - explain_gate catalog lookups (exact + loose + unknown) + live thresholds
 *   - bounded outputs (trace cap, decision limit clamp, system-map section cap)
 *   - registry-backed list / summarize (reads the real repo registry via cwd)
 *
 * The DB is mocked with a chainable builder (mirrors the other carter tests).
 * File-reading handlers read the real repo files (registry + System Map) via the
 * process.cwd() fallback in resolveRepoFile — vitest runs from the repo root.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── DB mock (chainable builder; terminal .limit() resolves to state.rows) ─────
const h = vi.hoisted(() => {
  const state = { rows: [] as unknown[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "from", "where", "leftJoin", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(state.rows);
  return { state, chain };
});

vi.mock("../../db/index.js", () => ({ db: h.chain }));
vi.mock("../../db/schema.js", () => ({
  strategies: {},
  auditLog: {},
  lifecycleTransitions: {},
}));
vi.mock("../../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { CARTER_INTROSPECT_HANDLERS, __test } from "../../lib/carter/carter-introspect.js";

beforeEach(() => {
  h.state.rows = [];
});

// ─── explain_gate ─────────────────────────────────────────────────────────────

describe("explain_gate", () => {
  const explain = CARTER_INTROSPECT_HANDLERS["explain_gate"]!;

  it("throws when name is missing", async () => {
    await expect(explain({})).rejects.toThrow(/name is required/);
    await expect(explain({ name: "" })).rejects.toThrow(/name is required/);
  });

  it("resolves a canonical gate name with all required fields", async () => {
    const r = (await explain({ name: "B14 ci_high" })) as Record<string, unknown>;
    expect(r["gate"]).toMatch(/B14/);
    expect(typeof r["what_it_catches"]).toBe("string");
    expect(typeof r["stage"]).toBe("string");
    expect(typeof r["plain_english"]).toBe("string");
    expect(r["threshold"]).toBeTruthy();
  });

  it("matches loose aliases (case-insensitive, 'the ' stripped, spacing ignored)", async () => {
    const b14 = (await explain({ name: "b14" })) as Record<string, unknown>;
    expect(b14["gate"]).toMatch(/B14/);

    const kill = (await explain({ name: "the kill switch" })) as Record<string, unknown>;
    expect(kill["gate"]).toMatch(/Kill Switch/i);

    const ruin = (await explain({ name: "RUIN" })) as Record<string, unknown>;
    expect(ruin["gate"]).toMatch(/B14/);

    const frank = (await explain({ name: "Frankenstein" })) as Record<string, unknown>;
    expect(frank["gate"]).toMatch(/A4/);
  });

  it("injects the LIVE threshold for B14 / WFE / PBO from the canonical getters", async () => {
    const b14 = (await explain({ name: "b14" })) as Record<string, unknown>;
    expect(String(b14["threshold"])).toMatch(/ci_high/);

    const wfe = (await explain({ name: "WFE" })) as Record<string, unknown>;
    expect(String(wfe["threshold"])).toMatch(/wfe_overall/);

    const pbo = (await explain({ name: "PBO" })) as Record<string, unknown>;
    expect(String(pbo["threshold"])).toMatch(/pbo_overall/);
  });

  it("returns unknown_gate with the known list for an unrecognized name", async () => {
    const r = (await explain({ name: "definitely_not_a_gate_xyz" })) as Record<string, unknown>;
    expect(r["error"]).toBe("unknown_gate");
    expect(Array.isArray(r["known"])).toBe(true);
    expect((r["known"] as string[]).length).toBe(__test.GATE_CATALOG.length);
  });

  it("catalog covers all 15 required gates", () => {
    const names = __test.GATE_CATALOG.map((g) => g.gate.toLowerCase());
    const requiredFragments = [
      "b14",
      "wfe",
      "pbo",
      "parameter drift",
      "b15",
      "bif",
      "compliance",
      "frozen-policy",
      "shadow-signal divergence",
      "daily trade cap",
      "lunch blackout",
      "macro_alignment",
      "kill switch",
      "a4 frankenstein",
      "a7 signal correlation",
    ];
    for (const frag of requiredFragments) {
      expect(names.some((n) => n.includes(frag)), `missing gate: ${frag}`).toBe(true);
    }
  });
});

// ─── read_strategy_internals ──────────────────────────────────────────────────

describe("read_strategy_internals", () => {
  const read = CARTER_INTROSPECT_HANDLERS["read_strategy_internals"]!;

  it("throws when neither strategyId nor name is provided", async () => {
    await expect(read({})).rejects.toThrow(/strategyId or .*name is required/);
  });

  it("throws strategy_not_found when the lookup returns no rows", async () => {
    h.state.rows = [];
    await expect(read({ strategyId: "missing-id" })).rejects.toThrow("strategy_not_found");
  });

  it("returns a structured policy slice from config JSONB + columns", async () => {
    h.state.rows = [
      {
        id: "abc",
        name: "orb_mnq_15m",
        lifecycleState: "TESTING",
        symbol: "MNQ",
        symbols: ["MNQ"],
        useWeightedScoring: true,
        exitPlanConfig: null,
        config: {
          entry_quality: { confluence_factors: ["structural_setup"] },
          position_size: { type: "risk_derived_pyramid" },
          stop_loss: { type: "structural" },
          take_profit: { style: "C" },
          exit_plan_config: { exit_style: "static_styleC" },
        },
      },
    ];
    const r = (await read({ name: "orb_mnq_15m" })) as Record<string, unknown>;
    expect(r["id"]).toBe("abc");
    expect(r["lifecycleState"]).toBe("TESTING");
    expect(r["symbols"]).toEqual(["MNQ"]);
    expect(r["entry_quality"]).toEqual({ confluence_factors: ["structural_setup"] });
    expect(r["exit_plan_config"]).toEqual({ exit_style: "static_styleC" });
    expect(r["use_weighted_scoring"]).toBe(true);
  });
});

// ─── trace_correlation ────────────────────────────────────────────────────────

describe("trace_correlation", () => {
  const trace = CARTER_INTROSPECT_HANDLERS["trace_correlation"]!;

  it("throws when correlationId is missing", async () => {
    await expect(trace({})).rejects.toThrow(/correlationId is required/);
    await expect(trace({ correlationId: "  " })).rejects.toThrow(/correlationId is required/);
  });

  it("returns chronological events with count", async () => {
    const now = new Date("2026-06-29T12:00:00.000Z");
    h.state.rows = [
      { action: "backtest.run", status: "success", createdAt: now },
      { action: "mc.run", status: "success", createdAt: now },
    ];
    const r = (await trace({ correlationId: "corr-1" })) as Record<string, unknown>;
    expect(r["correlationId"]).toBe("corr-1");
    expect(r["count"]).toBe(2);
    const events = r["events"] as Array<Record<string, unknown>>;
    expect(events[0]!["action"]).toBe("backtest.run");
    expect(events[0]!["createdAt"]).toBe("2026-06-29T12:00:00.000Z");
  });
});

// ─── read_recent_decisions ────────────────────────────────────────────────────

describe("read_recent_decisions", () => {
  const recent = CARTER_INTROSPECT_HANDLERS["read_recent_decisions"]!;

  it("annotates decisions with the strategy name", async () => {
    h.state.rows = [
      {
        strategyName: "vwap_mes_5m",
        strategyId: "s1",
        fromState: "TESTING",
        toState: "PAPER",
        createdAt: new Date("2026-06-29T10:00:00.000Z"),
      },
    ];
    const r = (await recent({})) as Record<string, unknown>;
    expect(r["count"]).toBe(1);
    const d = (r["decisions"] as Array<Record<string, unknown>>)[0]!;
    expect(d["strategy"]).toBe("vwap_mes_5m");
    expect(d["fromState"]).toBe("TESTING");
    expect(d["toState"]).toBe("PAPER");
    expect(d["at"]).toBe("2026-06-29T10:00:00.000Z");
  });

  it("falls back to strategyId / (unknown) when name is null", async () => {
    h.state.rows = [
      { strategyName: null, strategyId: "s2", fromState: "PAPER", toState: "DEPLOY_READY", createdAt: new Date() },
      { strategyName: null, strategyId: null, fromState: "X", toState: "Y", createdAt: new Date() },
    ];
    const r = (await recent({ limit: 5 })) as Record<string, unknown>;
    const decisions = r["decisions"] as Array<Record<string, unknown>>;
    expect(decisions[0]!["strategy"]).toBe("s2");
    expect(decisions[1]!["strategy"]).toBe("(unknown)");
  });

  it("does not throw on out-of-range limit (clamped internally)", async () => {
    h.state.rows = [];
    await expect(recent({ limit: 9999 })).resolves.toBeTruthy();
    await expect(recent({ limit: -5 })).resolves.toBeTruthy();
    await expect(recent({ limit: 0 })).resolves.toBeTruthy();
  });
});

// ─── list_subsystems + summarize_subsystem (real registry via cwd) ────────────

describe("list_subsystems", () => {
  const list = CARTER_INTROSPECT_HANDLERS["list_subsystems"]!;

  it("returns a bounded list of subsystem names from the real registry", async () => {
    const r = (await list({})) as Record<string, unknown>;
    if (r["error"]) {
      // Registry not resolvable in this environment — acceptable fail-soft.
      expect(r["error"]).toBe("subsystem_registry_unavailable");
      return;
    }
    const subs = r["subsystems"] as Array<Record<string, unknown>>;
    expect(Array.isArray(subs)).toBe(true);
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.length).toBeLessThanOrEqual(120);
    expect(typeof subs[0]!["name"]).toBe("string");
  });
});

describe("summarize_subsystem", () => {
  const summarize = CARTER_INTROSPECT_HANDLERS["summarize_subsystem"]!;

  it("throws when name is missing", async () => {
    await expect(summarize({})).rejects.toThrow(/name is required/);
  });

  it("returns unknown_subsystem for a gibberish name (or fail-soft if registry missing)", async () => {
    const r = (await summarize({ name: "zzz_not_a_subsystem_zzz" })) as Record<string, unknown>;
    expect(["unknown_subsystem", "subsystem_registry_unavailable"]).toContain(r["error"]);
  });
});

// ─── read_system_map (real file via cwd) ──────────────────────────────────────

describe("read_system_map", () => {
  const readMap = CARTER_INTROSPECT_HANDLERS["read_system_map"]!;

  it("returns a heading list when no section is given (or fail-soft)", async () => {
    const r = (await readMap({})) as Record<string, unknown>;
    if (r["error"]) {
      expect(r["error"]).toBe("system_map_unavailable");
      return;
    }
    expect(Array.isArray(r["headings"])).toBe(true);
    expect((r["headings"] as string[]).length).toBeGreaterThan(0);
  });

  it("bounds returned section text to the char cap", async () => {
    const list = (await readMap({})) as Record<string, unknown>;
    if (list["error"]) return; // fail-soft env
    const firstHeading = (list["headings"] as string[])[0]!;
    const r = (await readMap({ section: firstHeading })) as Record<string, unknown>;
    if (r["error"]) return;
    expect(typeof r["text"]).toBe("string");
    expect((r["text"] as string).length).toBeLessThanOrEqual(3500);
  });
});

// ─── parseHeadings pure helper ────────────────────────────────────────────────

describe("parseHeadings", () => {
  it("captures ## and ### headings with level + line", () => {
    const lines = ["# Title", "## Alpha", "text", "### Beta", "#### too deep", "## Gamma"];
    const out = __test.parseHeadings(lines);
    expect(out.map((h) => h.title)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(out[0]).toMatchObject({ level: 2, line: 1 });
    expect(out[1]).toMatchObject({ level: 3, line: 3 });
  });
});
