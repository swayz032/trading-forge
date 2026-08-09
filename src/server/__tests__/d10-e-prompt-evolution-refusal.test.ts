/**
 * D-10 LANE `E` — prompt-evolution compatibility with `system_journal.status='refused'`
 * (R-770 §6).
 *
 * ─── WHY THIS LANE EXISTS ────────────────────────────────────────────────────
 *
 * `F-7` began writing a NEW journal status, `'refused'`. Two whitelists in
 * `prompt-evolution-service.ts` (`:226` weekly corpus, `:682` A/B metrics) read
 *   `status IN ('tested','failed','promoted')`
 * so an engine refusal — previously written `'failed'` and therefore INSIDE both
 * corpora — became SILENTLY INVISIBLE to prompt learning.
 *
 * ─── THE POLICY R-770 §4 DECIDED, WHICH THIS SUITE ENCODES ───────────────────
 *
 *   `AN ENGINE REFUSAL IS PROMPT-QUALITY / EXECUTABILITY EVIDENCE.
 *    IT IS NOT STRATEGY-PERFORMANCE EVIDENCE. NEVER COLLAPSE THE TWO AGAIN.`
 *
 * Both halves are load-bearing and each has its own failure mode:
 *   - Excluding refusals entirely => a proposer that keeps emitting unexecutable
 *     strategies gets no corrective signal. F-7 would have disabled a feedback loop.
 *   - Including them BLINDLY => rows with NO tier and NO forge score land in a corpus
 *     that groups by tier and averages forge scores, teaching
 *     "unmeasured strategy = bad strategy" — the exact conflation D-10 exists to remove.
 *       `REFUSED MUST BE VISIBLE, AND REFUSED MUST STAY MARKED UNMEASURED.`
 *
 * ─── 🛑 SCOPE BOUNDARY, STATED RATHER THAN IMPLIED ───────────────────────────
 *
 * The two whitelists are SQL predicates. A mocked `db` cannot enforce them, and a
 * fixture that re-implemented the filter would be measuring the fixture, not the
 * service.
 *   `A CONTROL THAT ENCODES THE PREDICATE IT IS TESTING MEASURES ITS OWN MOCK.`
 * So the division of evidence is explicit:
 *   - the SQL predicate text is guarded by the SOURCE assertion in
 *     `b11-b12-feedback-loops.test.ts` (a WIRING guard — it pins spelling, not meaning,
 *     and R-770 §6 forbids it standing as the acceptance proof);
 *   - EVERYTHING DOWNSTREAM of the fetch — bucketing, forge-score exclusion,
 *     pass/attempt accounting, and the promotion guard — is behavioural, below,
 *     driven through the real exported entrypoints `runPromptEvolution`,
 *     `resolveAbTests`, and `__collectVariantMetricsForTest`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const rec = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  selectCalls: 0,
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  llmPrompts: [] as string[],
}));

vi.mock("../db/index.js", () => {
  const chainFor = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    const resolve = () => Promise.resolve(rows);
    chain["where"] = () => chain;
    chain["orderBy"] = () => chain;
    chain["limit"] = () => resolve();
    chain["then"] = (r: (v: unknown[]) => void) => resolve().then(r);
    return { from: () => chain };
  };
  return {
    db: {
      select: () => {
        const rows = rec.selectQueue[rec.selectCalls] ?? [];
        rec.selectCalls++;
        return chainFor(rows);
      },
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          rec.updates.push(patch);
          return { where: () => Promise.resolve([]) };
        },
      }),
      insert: () => ({
        values: (v: Record<string, unknown>) => {
          rec.inserts.push(v);
          return {
            returning: () => Promise.resolve([{ id: "row-1" }]),
            catch: () => Promise.resolve(undefined),
            then: (r: (x: unknown) => void) => Promise.resolve([{ id: "row-1" }]).then(r),
          };
        },
      }),
    },
  };
});

vi.mock("../services/model-router.js", () => ({
  // Capturing the prompt is the whole point: `buildEvolutionPrompt`'s output is not
  // otherwise observable, and this is the REAL production hand-off, not a new seam.
  callOpenAI: vi.fn(async (_role: string, msgs: Array<{ content: string }>) => {
    rec.llmPrompts.push(msgs.map((m) => m.content).join("\n"));
    return JSON.stringify({
      appendix_text: "APPENDIX TEXT LONG ENOUGH TO PASS THE LENGTH GUARD",
      patterns: [],
    });
  }),
  getFallback: vi.fn(() => ({ model: "gemma4:e4b-it-qat" })),
  loadSystemPrompt: vi.fn(() => "sys"),
  setAppendixCache: vi.fn(),
}));

vi.mock("../services/ollama-client.js", () => ({
  OllamaClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn(async () => ({ response: "{}" })),
  })),
}));

vi.mock("../routes/sse.js", () => ({ broadcastSSE: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const V_A = "aaaaaaaa-0000-0000-0000-000000000001";
const V_B = "bbbbbbbb-0000-0000-0000-000000000002";

/** A measured, backtested entry: it HAS a tier and a forge score. */
function measured(versionId: string, forge: number, tier = "TIER_1", status = "tested") {
  return {
    id: `m-${versionId}-${forge}-${tier}-${status}`,
    source: "openclaw",
    generationPrompt: "a measured concept",
    strategyParams: { symbol: "MES", timeframe: "5m" },
    forgeScore: String(forge),
    tier,
    status,
    generationPromptVersionId: versionId,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    strategyId: "s-1",
  };
}

/**
 * A REFUSED entry as `F-7` actually writes it: NO tier, NO forge score.
 * Those two nulls are the whole hazard — anything that averages them as `0`
 * teaches "unmeasured = bad".
 */
function refused(versionId: string, n: number) {
  return {
    id: `r-${versionId}-${n}`,
    source: "openclaw",
    generationPrompt: "an ambiguous concept the engine declined to execute",
    strategyParams: { symbol: "MES", timeframe: "5m" },
    forgeScore: null,
    tier: null,
    status: "refused",
    generationPromptVersionId: versionId,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    strategyId: "s-2",
  };
}

function manyMeasured(versionId: string, count: number, forge: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...measured(versionId, forge),
    id: `m-${versionId}-${i}`,
  }));
}
function manyRefused(versionId: string, count: number) {
  return Array.from({ length: count }, (_, i) => refused(versionId, i));
}

beforeEach(() => {
  rec.selectQueue = [];
  rec.selectCalls = 0;
  rec.updates.length = 0;
  rec.inserts.length = 0;
  rec.llmPrompts.length = 0;
  vi.resetModules();
});

async function svc() {
  return await import("../services/prompt-evolution-service.js");
}

/** The analysis prompt the service actually handed to the model. */
function analysisPrompt(): string {
  expect(
    rec.llmPrompts.length,
    "no LLM prompt was built — runPromptEvolution never reached the model",
  ).toBeGreaterThan(0);
  return rec.llmPrompts.join("\n");
}

describe("D-10 E — the weekly corpus sees refusals, and sees them as UNMEASURED (R-770 §6 A)", () => {
  it("E.1 a refused entry is VISIBLE to prompt feedback, in its OWN bucket", async () => {
    rec.selectQueue = [[...manyMeasured(V_A, 3, 70), ...manyRefused(V_A, 2)]];
    const mod = await svc();
    await mod.runPromptEvolution();

    expect(analysisPrompt(), "refusals are invisible to the prompt learner").toContain(
      "REFUSED_UNMEASURED",
    );
  });

  it("E.2 the refused bucket carries NO forge score — never a zero", async () => {
    rec.selectQueue = [[...manyMeasured(V_A, 3, 70), ...manyRefused(V_A, 2)]];
    const mod = await svc();
    await mod.runPromptEvolution();

    const line = analysisPrompt()
      .split("\n")
      .find((l) => l.includes("REFUSED_UNMEASURED"));
    expect(line, "the refused bucket has no heading line").toBeDefined();
    // The defect this whole campaign exists to remove: an unmeasured run presented
    // as a measured zero.
    expect(line, "a refusal was given a fabricated forge score of 0").not.toMatch(
      /avg forge score:\s*0\b/,
    );
  });

  it("E.3 the prompt TELLS the model these were not backtested — visibility without that is a trap", async () => {
    rec.selectQueue = [[...manyMeasured(V_A, 3, 70), ...manyRefused(V_A, 2)]];
    const mod = await svc();
    await mod.runPromptEvolution();

    const p = analysisPrompt().toLowerCase();
    expect(p, "the model is not told the refused bucket was never backtested").toMatch(
      /not backtested|never backtested|were not executed/,
    );
    expect(p, "the model is not warned off inferring performance from refusals").toMatch(
      /do not infer|not.*performance evidence|no performance/,
    );
  });

  it("E.4 POSITIVE CONTROL — a refusal does NOT join a measured tier bucket", async () => {
    rec.selectQueue = [[...manyMeasured(V_A, 3, 70), ...manyRefused(V_A, 2)]];
    const mod = await svc();
    await mod.runPromptEvolution();

    const tierLine = analysisPrompt()
      .split("\n")
      .find((l) => l.startsWith("### TIER_1"));
    expect(tierLine, "the measured tier bucket vanished").toBeDefined();
    // 3 measured entries, and the 2 refusals must not be counted among them.
    expect(tierLine).toContain("(3 strategies");
  });
});

describe("D-10 E — A/B attempt accounting (R-770 §6 B)", () => {
  it("E.5 attempts RISE with refusals · passed does NOT · the forge sample count does NOT", async () => {
    rec.selectQueue = [[...manyMeasured(V_B, 4, 60), ...manyRefused(V_B, 3)]];
    const mod = await svc();
    const m = await mod.__collectVariantMetricsForTest(V_B, new Date("2026-07-01"));

    expect(m.totalStrategies, "refusals were not counted as attempts").toBe(7);
    expect(m.passedStrategies, "a refusal was counted as a pass").toBe(4);
    // THE CORE INVARIANT: a refusal contributes NOTHING to the forge average.
    expect(m.forgeScores.length, "a refusal contributed a forge score").toBe(4);
    expect(m.avgForgeScore, "the forge average was diluted by unmeasured rows").toBe(60);
  });

  it("E.6 POSITIVE CONTROL — with no refusals present, every number is unchanged", async () => {
    rec.selectQueue = [manyMeasured(V_B, 4, 60)];
    const mod = await svc();
    const m = await mod.__collectVariantMetricsForTest(V_B, new Date("2026-07-01"));

    expect(m.totalStrategies).toBe(4);
    expect(m.passedStrategies).toBe(4);
    expect(m.passRate).toBe(1);
    expect(m.avgForgeScore).toBe(60);
  });
});

describe("D-10 E — the promotion guard (R-770 §5/§6 C)", () => {
  const runningTest = {
    id: "test-1",
    promptType: "strategy_proposer",
    versionAId: V_A,
    versionBId: V_B,
    status: "running",
    startedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
  };

  /** The winner recorded by concludeTest, or null when no test was concluded. */
  function concludedWinner(): string | null {
    const w = rec.updates.find((u) => typeof u.winner === "string");
    return w ? String(w.winner) : null;
  }

  it("E.7 a variant with a MATERIALLY worse refusal rate cannot win on forge score alone", async () => {
    // A: 20 measured @50, zero refusals.  B: 20 measured @60 (+10, well over the
    // forge threshold of 3) but 5 refusals => refusal rate 0.20 vs 0.00.
    const rows = [
      ...manyMeasured(V_A, 20, 50),
      ...manyMeasured(V_B, 20, 60),
      ...manyRefused(V_B, 5),
    ];
    rec.selectQueue = [[runningTest], rows, rows];
    const mod = await svc();
    await mod.resolveAbTests();

    expect(
      concludedWinner(),
      "a high-refusal variant won on forge score alone — a high forge score erased a material executability regression",
    ).not.toBe("B");
  });

  it("E.8 MIRROR — with no executability regression, a genuinely better variant STILL wins", async () => {
    // Same forge improvement, same sample sizes, NO refusal regression.
    // Without this mirror, E.7 is unfalsifiable: a guard that blocks every
    // promotion would pass it.
    const rows = [...manyMeasured(V_A, 20, 50), ...manyMeasured(V_B, 20, 60)];
    rec.selectQueue = [[runningTest], rows, rows];
    const mod = await svc();
    await mod.resolveAbTests();

    expect(
      concludedWinner(),
      "the guard blocks promotions it should permit — E.7 would then prove nothing",
    ).toBe("B");
  });
});
