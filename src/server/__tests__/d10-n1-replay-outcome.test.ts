/**
 * D-10 `N-1` — the critic replay-outcome controls (R-757 §3 + §4).
 *
 * `AR-866` shipped `N-1`'s production repair BEFORE its red test and named itself
 * UNCONTROLLED rather than letting `42 passed` cover it. `R-757 §2` upheld the patch
 * and kept the label attached until THIS file lands. These are those controls, and
 * they were written and observed RED before the repair they guard.
 *
 * ─── THE TWO DEFECTS R-757 §3 CONFIRMED AT THE EXECUTABLE LINE ───────────────
 *
 * DEFECT 1 — the refusal `.set()` carried the comment
 *     "No tier, no score, no actualCompositeScore. Absent, NOT zero."
 *   but in drizzle, OMITTING a column from `.set()` means LEAVE THE EXISTING VALUE.
 *   So a candidate that previously COMPLETED — carrying a real tier and scores — and
 *   is LATER refused keeps all three beside `replayStatus:"refused"`. The refusal
 *   becomes indistinguishable from a scored result wearing a refusal's status.
 *     `A COMMENT ASSERTING AN ABSENCE ITS OWN STATEMENT DOES NOT CREATE DOCUMENTS
 *      THE CORRECT DESIGN WHILE SHIPPING THE WRONG ONE.`
 *
 * DEFECT 2 — `rr?.forge_score ?? 0` survived at the completed path. The `R-755 §3`
 *   repair fixed the KEY CASING and kept the COERCION, so a completed response
 *   MISSING `forge_score` still becomes a measured zero.
 *     `FIXING THE KEY WHILE KEEPING THE COERCION FIXES THE SPELLING OF THE LIE.`
 *
 * ─── WHAT EACH CONTROL IS FOR (so a later seat cannot mistake one for another) ──
 *
 *   N-1.1 / N-1.2  refusal CLEARS stale metrics — one per production caller
 *   N-1.3          completed-but-unscoreable becomes a NAMED failure, never `0`
 *   N-1.4          POSITIVE CONTROL: a real finite score survives UNCHANGED
 *   N-1.5          DELEGATION SPY: both real callers reach the shared handler
 *   N-1.6          a refusal never becomes a ranking candidate
 *   N-1.7..N-1.10  the shared classifier against the real live envelope
 *
 * ★ N-1.4 is the control that must stay GREEN under every mutation aimed at the
 *   others. A suite where every test reddens together cannot tell "catches breakage"
 *   from "always red".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Recorded production effects ─────────────────────────────────────────────
const rec = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  sse: [] as Array<{ event: string; data: Record<string, unknown> }>,
  classifyCalls: [] as unknown[],
  driveError: undefined as unknown,
}));

// The result `runBacktest` will return, set per test.
const btResult = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("../db/index.js", () => {
  const rowsFor = () => [] as unknown[];
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    const resolve = () => Promise.resolve(rowsFor());
    chain["where"] = () => chain;
    chain["orderBy"] = () => chain;
    chain["limit"] = () => resolve();
    chain["then"] = (r: (v: unknown[]) => void) => resolve().then(r);
    return { from: () => chain };
  };
  return {
    db: {
      // `select()` is overridden per-test via `selectQueue`; default empty.
      select: () => makeChain(),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
      update: () => ({
        set: (patch: Record<string, unknown>) => {
          rec.updates.push(patch);
          return { where: () => Promise.resolve([]) };
        },
      }),
    },
  };
});

vi.mock("../routes/sse.js", () => ({
  broadcastSSE: (event: string, data: Record<string, unknown>) => {
    rec.sse.push({ event, data });
  },
}));

vi.mock("../index.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/backtest-service.js", () => ({
  runBacktest: vi.fn(async () => btResult.value),
}));

// ─── THE DELEGATION SPY (R-757 §4-3) ─────────────────────────────────────────
// Wrapped, NOT replaced: `importOriginal` keeps the REAL classification running, so
// this file proves delegation AND behaviour with one harness. A stubbed handler would
// prove the call and measure nothing about what the call decides.
vi.mock("../lib/replay-outcome.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/replay-outcome.js")>();
  return {
    ...actual,
    classifyReplayOutcome: (result: unknown) => {
      rec.classifyCalls.push(result);
      return actual.classifyReplayOutcome(result);
    },
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const RUN_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const STRAT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CAND_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const BT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

/**
 * The REAL refusal envelope, as the Python boundary emits it (`R-757 §4`).
 * `status` is what `isExecutionRefused` keys on; the rest is the evidence a consumer
 * must preserve rather than invent.
 */
const REFUSED_RESULT = {
  id: BT_ID,
  status: "refused",
  execution_status: "REFUSED",
  condition_id: "opening_range_trigger",
  disposition: "SOURCE_AMBIGUOUS",
  reason: "opening range duration not stated by the source",
};

/** A completed replay carrying a genuine, finite score. */
const COMPLETED_SCORED = { id: BT_ID, status: "completed", tier: "TIER_2", forge_score: 73.5 };

/** Completed, but the engine returned NO score. The `?? 0` defect's input. */
const COMPLETED_NO_SCORE = { id: BT_ID, status: "completed", tier: "TIER_2" };

/**
 * A candidate that clears EVERY gate between the loop head and `runBacktest`:
 * precommit (`:2228`), lookahead (`:2273`), H-8 bounds (`:2329`, inert because the
 * strategy config declares no `entry_indicator`), and param application (`:2362`,
 * vacuous on an empty change set). If any gate caught it, the run would never reach
 * the branch under test and every assertion below would pass vacuously — which is
 * why N-1.5 asserts the handler was reached at all.
 */
const CANDIDATE = {
  id: CAND_ID,
  runId: RUN_ID,
  rank: 1,
  changedParams: {},
  governanceMeta: null,
  governanceLabels: null,
};

const STRATEGY_ROW = { id: STRAT_ID, config: {}, forgeScore: "50" };

/**
 * Drive the AUTOMATIC path (`replayCandidatesAsync`) or the MANUAL path
 * (`manualReplayCandidates`) against a given `runBacktest` result.
 *
 * Both are real production entrypoints: the automatic one is called at `:810` and
 * `:1246`; the manual one is the exported handler behind the replay route.
 */
async function drive(path: "auto" | "manual", result: unknown): Promise<void> {
  btResult.value = result;
  const { db } = await import("../db/index.js");

  // ─── SELECT ORDER IS PER-PATH, AND THEY ARE NOT THE SAME ──────────────────
  // The automatic path reads strategy → candidates → evidence packet (`:2109`,
  // `:2131`, `:2155`). The MANUAL path reads candidates → strategy → evidence
  // packet (`:2801`, `:2816`, `:2839`). Feeding the automatic order to the manual
  // path hands it the STRATEGY row as a candidate, `changedParams` is undefined,
  // param application throws, and the candidate is filed `failed` — a fixture bug
  // that looks exactly like a production refusal defect. Measured, not assumed.
  //
  // The trailing row satisfies the post-replay MC survival gate (`:2487`), which
  // polls `monteCarloRuns` for up to MC_GATE_WAIT_MS = 60_000ms. Without it the
  // COMPLETED path blocks for a full minute and the test times out mid-flight,
  // leaving a live async run that corrupts the NEXT test's recorded writes.
  const MC_SATISFIED = [{ probabilityOfRuin: "0.01" }];
  const queue: unknown[][] = path === "auto"
    ? [[STRATEGY_ROW], [CANDIDATE], [], MC_SATISFIED]
    : [[CANDIDATE], [STRATEGY_ROW], [], MC_SATISFIED];
  let call = 0;
  (db as unknown as { select: unknown }).select = () => {
    const rows = queue[Math.min(call++, queue.length - 1)] ?? [];
    const chain: Record<string, unknown> = {};
    const resolve = () => Promise.resolve(rows);
    chain["where"] = () => chain;
    chain["orderBy"] = () => chain;
    chain["limit"] = () => resolve();
    chain["then"] = (r: (v: unknown[]) => void) => resolve().then(r);
    return { from: () => chain };
  };

  const mod = await import("../services/critic-optimizer-service.js");
  // ─── WHY A DOWNSTREAM THROW IS CAUGHT AND NAMED, NOT SWALLOWED ────────────
  // The outcome write under test happens INSIDE the replay loop. A candidate that
  // both ranks AND beats the parent forge score then proceeds into SURVIVOR
  // PROMOTION, which this stub DB cannot satisfy (`Cannot convert undefined or null
  // to object`). That throw is downstream of the decision these controls measure.
  // It is recorded, not hidden — and `N-1.3`'s assertion still discriminates, so
  // catching here cannot make any control pass vacuously.
  // 🛑 SCOPE, STATED: end-to-end survivor promotion is NOT exercised by this file.
  try {
    if (path === "auto") {
      await mod.replayCandidatesAsync(RUN_ID, STRAT_ID, {}, "corr-1");
    } else {
      await mod.manualReplayCandidates(RUN_ID, STRAT_ID, [CAND_ID], { correlationId: "corr-1" });
    }
  } catch (err) {
    rec.driveError = err;
  }
}

/**
 * The SURVIVOR-SELECTION write — `.set({ selected: true })`, the act by which a
 * candidate is actually chosen. Both production paths perform it: the automatic one
 * at `critic-optimizer-service.ts:2551`, the manual one at `:3026`.
 *
 * ★ This is the witness `N-1.19` and `N-1.20` share. An earlier draft of `N-1.19`
 *   used "the stub threw during promotion" instead — which worked by accident on the
 *   automatic path and DOES NOT EXIST on the manual one, so it could never have made
 *   the two controls symmetric. A witness that is an artifact of the fixture is not a
 *   witness to the behaviour.
 */
function survivorSelected(): boolean {
  return rec.updates.some((u) => u.selected === true);
}

/** Every `.set()` patch that carried a `replayStatus` — i.e. the outcome writes. */
function outcomeWrites(): Array<Record<string, unknown>> {
  return rec.updates.filter((u) => "replayStatus" in u);
}

/**
 * The single outcome write for the candidate under test.
 *
 * Two writes are excluded and neither is the decision under test:
 *   "running"          — the pre-replay marker written before `runBacktest`.
 *   `replay_incomplete` — the post-loop sweep that fails candidates left un-terminal.
 *                         It fires here only because this stub DB never PERSISTS the
 *                         write the loop just made, so the sweep re-reads the
 *                         candidate as unfinished. A fixture artifact, measured and
 *                         named rather than absorbed.
 */
function terminalWrite(): Record<string, unknown> {
  const w = outcomeWrites().filter(
    (u) =>
      u.replayStatus !== "running" &&
      (u.governanceLabels as { failure_reason?: string } | undefined)?.failure_reason !==
        "replay_incomplete",
  );
  expect(w.length, `expected exactly one terminal outcome write, got: ${JSON.stringify(w)}`).toBe(1);
  return w[0]!;
}

beforeEach(() => {
  rec.updates.length = 0;
  rec.sse.length = 0;
  rec.classifyCalls.length = 0;
  rec.driveError = undefined;
  vi.resetModules();
});

describe("D-10 N-1 — replay outcome (R-757 §3 defects 1 and 2, §4 controls)", () => {
  // ─── DEFECT 1 ──────────────────────────────────────────────────────────────
  it("N-1.1 [auto] a refusal EXPLICITLY nulls tier and both scores, so a previously-scored candidate cannot keep them", async () => {
    await drive("auto", REFUSED_RESULT);
    const w = terminalWrite();

    expect(w.replayStatus).toBe("refused");
    // The whole point: drizzle OMISSION means LEAVE. These must be PRESENT and null.
    expect(w).toHaveProperty("replayTier", null);
    expect(w).toHaveProperty("replayForgeScore", null);
    expect(w).toHaveProperty("actualCompositeScore", null);
  });

  it("N-1.2 [manual] the same clearing happens on the manual path — one caller fixed is not the defect fixed", async () => {
    await drive("manual", REFUSED_RESULT);
    const w = terminalWrite();

    expect(w.replayStatus).toBe("refused");
    expect(w).toHaveProperty("replayTier", null);
    expect(w).toHaveProperty("replayForgeScore", null);
    expect(w).toHaveProperty("actualCompositeScore", null);
  });

  // ─── DEFECT 2 ──────────────────────────────────────────────────────────────
  it("N-1.3 [auto] completed WITHOUT a finite forge_score becomes a NAMED invalid result — never a measured 0", async () => {
    await drive("auto", COMPLETED_NO_SCORE);
    const w = terminalWrite();

    expect(w.replayStatus).not.toBe("completed");
    expect(w.replayStatus).toBe("invalid_result");
    // A fabricated zero is the exact defect; assert the VALUE, not just the status.
    expect(w.replayForgeScore ?? null).toBeNull();
    expect(w.actualCompositeScore ?? null).toBeNull();
    expect(String(w.replayForgeScore)).not.toBe("0");
  });

  // ─── POSITIVE CONTROL ──────────────────────────────────────────────────────
  it("N-1.4 [auto] POSITIVE CONTROL — a legitimate finite forge_score is persisted UNCHANGED", async () => {
    await drive("auto", COMPLETED_SCORED);
    const w = terminalWrite();

    expect(w.replayStatus).toBe("completed");
    expect(w.replayTier).toBe("TIER_2");
    expect(String(w.replayForgeScore)).toBe("73.5");
    expect(String(w.actualCompositeScore)).toBe("73.5");
  });

  it("N-1.4b [auto] a MEASURED finite zero is still a zero — the repair must not swallow real zeros", async () => {
    await drive("auto", { id: BT_ID, status: "completed", tier: "TIER_3", forge_score: 0 });
    const w = terminalWrite();

    expect(w.replayStatus).toBe("completed");
    expect(String(w.replayForgeScore)).toBe("0");
  });

  // ─── DELEGATION (EXISTENCE IS NOT WIRING) ──────────────────────────────────
  it("N-1.5 BOTH production callers delegate to the shared handler — a well-tested function nobody calls is not a fix", async () => {
    await drive("auto", REFUSED_RESULT);
    expect(rec.classifyCalls.length, "automatic path never reached the shared handler").toBeGreaterThan(0);

    rec.classifyCalls.length = 0;
    rec.updates.length = 0;
    await drive("manual", REFUSED_RESULT);
    expect(rec.classifyCalls.length, "manual path never reached the shared handler").toBeGreaterThan(0);
  });

  // ─── REFUSAL NEVER RANKS ───────────────────────────────────────────────────
  it("N-1.6 [auto] a refusal is never written as completed and never carries a tier onward to ranking", async () => {
    await drive("auto", REFUSED_RESULT);

    expect(outcomeWrites().some((u) => u.replayStatus === "completed")).toBe(false);
    // The ranking gate keys on tier; a refusal must not emit one on the complete event.
    const completeEvents = rec.sse.filter((s) => s.event === "critic:replay_complete");
    expect(completeEvents.some((s) => "tier" in s.data)).toBe(false);
    expect(rec.sse.some((s) => s.event === "critic:replay_refused")).toBe(true);
  });
});

// ─── THE SHARED CLASSIFIER, AGAINST THE REAL LIVE ENVELOPE (R-757 §4) ────────
describe("D-10 N-1 — shared classifier direct controls", () => {
  it("N-1.7 the real refusal envelope classifies as refused", async () => {
    const { classifyReplayOutcome } = await import("../lib/replay-outcome.js");
    expect(classifyReplayOutcome(REFUSED_RESULT).kind).toBe("refused");
  });

  it("N-1.8 a completed result does NOT classify as refused", async () => {
    const { classifyReplayOutcome } = await import("../lib/replay-outcome.js");
    expect(classifyReplayOutcome(COMPLETED_SCORED).kind).toBe("completed");
  });

  it("N-1.9 null / malformed input returns a decision WITHOUT THROWING", async () => {
    const { classifyReplayOutcome } = await import("../lib/replay-outcome.js");
    for (const bad of [null, undefined, 0, "", "refused", [], { status: 42 }, { nope: true }]) {
      expect(() => classifyReplayOutcome(bad)).not.toThrow();
      expect(classifyReplayOutcome(bad).kind).not.toBe("refused");
    }
  });

  it("N-1.10 refusal evidence preserves the ACTUAL fields and invents none", async () => {
    const { classifyReplayOutcome } = await import("../lib/replay-outcome.js");
    const out = classifyReplayOutcome(REFUSED_RESULT);
    if (out.kind !== "refused") throw new Error("fixture is not a refusal");

    expect(out.evidence.execution_status).toBe("REFUSED");
    expect(out.evidence.condition_id).toBe("opening_range_trigger");
    // `R-753 §2-3` was an `entry_eligible` FABRICATION one layer in. The classifier
    // must not become the new inventor: a key the result never carried stays absent.
    expect(out.evidence).not.toHaveProperty("entry_eligible");
    expect(out.evidence).not.toHaveProperty("metrics_omitted");
  });
});

// ─── R-758 §6a — THE STATUS/TIER TRUTH GAP ──────────────────────────────────
//
// `R-758` accepted the work above and then handed `N-1` back as PARTIAL, because the
// handler removed the fabricated SCORE and left a fabricated TIER one field over —
// the exact shape `R-757 §3` had just minted a law about, reproduced by the repair
// that was citing it.
//
//   `A FABRICATED VALUE THAT IS ALSO TRUSTED DOWNSTREAM IS NOT ONE DEFECT, IT IS A
//    FALSE MEASUREMENT PLUS A FALSE PERMISSION.`
//
// GAP 1 (R-758 §2, LATENT): nothing required `status:"completed"`. A `failed` or
//   status-less result carrying a finite score would have classified as completed,
//   scored, ranking-eligible evidence. It is LATENT only because the producer's one
//   `failed` return happens to carry no `forge_score` — and
//   `SAFETY BY STARVATION IS NOT SAFETY BY DESIGN`.
//
// GAP 2 (R-758 §3, LIVE, with a positive witness): `typeof tierRaw === "string" ?
//   tierRaw : "REJECTED"` invented a rejection the engine never issued AND left it
//   `rankingEligible`. `backtest-service.ts:1725` branches on `!result.tier`, which
//   is the producer's own witness that untiered completed results occur —
//   `THE CHEAPEST REACHABILITY PROOF IN THE CODEBASE IS SOMEONE ELSE'S DEFENSIVE
//    BRANCH.` Third-order: `typeof === "string"` admitted ANY string, so `"BANANA"`
//   passed through as a tier.
describe("D-10 N-1 (R-758 §6a) — status and tier must be EXPLICIT, never inferred", () => {
  async function classify(result: unknown) {
    const { classifyReplayOutcome } = await import("../lib/replay-outcome.js");
    return classifyReplayOutcome(result);
  }

  it("N-1.11 a `failed` result carrying a stale finite score is NOT completed", async () => {
    const out = await classify({ id: BT_ID, status: "failed", tier: "TIER_1", forge_score: 91.2 });
    expect(out.kind).toBe("invalid");
    expect(out.rankingEligible).toBe(false);
    expect(out.patch.replayTier).toBeNull();
    expect(out.patch.replayForgeScore).toBeNull();
    expect(out.patch.actualCompositeScore).toBeNull();
  });

  it("N-1.12 a result with NO status at all is NOT completed, however well-formed the rest looks", async () => {
    const out = await classify({ id: BT_ID, tier: "TIER_1", forge_score: 91.2 });
    expect(out.kind).toBe("invalid");
    expect(out.rankingEligible).toBe(false);
    expect(out.patch.replayTier).toBeNull();
  });

  it("N-1.13 completed with NO tier is invalid — the handler must NEVER invent `REJECTED`", async () => {
    const out = await classify({ id: BT_ID, status: "completed", forge_score: 64.0 });
    expect(out.kind).toBe("invalid");
    // The whole defect: a rejection the engine never issued.
    expect(out.patch.replayTier).toBeNull();
    expect(out.patch.replayTier).not.toBe("REJECTED");
    expect(out.rankingEligible).toBe(false);
  });

  it("N-1.14 completed with an UNRECOGNIZED tier is invalid — fixing only the ABSENT case is one level short", async () => {
    const out = await classify({ id: BT_ID, status: "completed", tier: "BANANA", forge_score: 64.0 });
    expect(out.kind).toBe("invalid");
    expect(out.patch.replayTier).toBeNull();
    expect(out.rankingEligible).toBe(false);
  });

  it("N-1.15 an EXPLICIT completed REJECTED is real measured evidence, but is NOT ranking-eligible", async () => {
    const out = await classify({ id: BT_ID, status: "completed", tier: "REJECTED", forge_score: 12.5 });
    // It was measured, so it is completed evidence and its numbers are preserved...
    expect(out.kind).toBe("completed");
    expect(out.patch.replayTier).toBe("REJECTED");
    expect(String(out.patch.replayForgeScore)).toBe("12.5");
    // ...but the engine rejected it, so it may never rank.
    expect(out.rankingEligible).toBe(false);
  });

  it("N-1.16 POSITIVE CONTROL — explicit completed + recognized tier + finite score ranks, unchanged", async () => {
    const out = await classify({ id: BT_ID, status: "completed", tier: "TIER_2", forge_score: 73.5 });
    expect(out.kind).toBe("completed");
    expect(out.patch.replayTier).toBe("TIER_2");
    expect(String(out.patch.replayForgeScore)).toBe("73.5");
    expect(String(out.patch.actualCompositeScore)).toBe("73.5");
    expect(out.rankingEligible).toBe(true);
  });

  it("N-1.17 each invalid class carries its OWN reason string — one bucket cannot diagnose six causes", async () => {
    const reasons = new Set<string>();
    for (const r of [
      { id: BT_ID, status: "failed", forge_score: 5 },
      { id: BT_ID, forge_score: 5 },
      { id: BT_ID, status: "completed", tier: "TIER_1" },
      { id: BT_ID, status: "completed", tier: "TIER_1", forge_score: Number.NaN },
      { id: BT_ID, status: "completed", forge_score: 5 },
      { id: BT_ID, status: "completed", tier: "BANANA", forge_score: 5 },
    ]) {
      const out = await classify(r);
      expect(out.kind).toBe("invalid");
      if (out.kind === "invalid") reasons.add(out.reason);
    }
    expect(reasons.size, `expected six distinct reasons, got ${JSON.stringify([...reasons])}`).toBe(6);
  });

  it("N-1.18 [auto] the CALLER obeys rankingEligible — an explicit REJECTED never enters survivor promotion", async () => {
    // Positive witness that the path RAN: the terminal write happened at all.
    // Discriminator: a ranking-eligible candidate whose score beats the parent (50)
    // proceeds into survivor promotion, which this stub cannot satisfy and which
    // therefore throws. A non-ranking outcome returns cleanly. So `driveError`
    // undefined + a completed REJECTED write == the caller consumed the verdict
    // instead of reconstructing it from the tier string.
    await drive("auto", { id: BT_ID, status: "completed", tier: "REJECTED", forge_score: 99.9 });
    const w = terminalWrite();
    expect(w.replayStatus).toBe("completed");
    expect(w.replayTier).toBe("REJECTED");
    expect(survivorSelected(), "a REJECTED candidate was selected as survivor").toBe(false);
  });

  it("N-1.19 [auto] RANKING WITNESS — a TIER_2 result DOES enter survivor promotion", async () => {
    // The discriminating half of the consumption proof. `N-1.18` alone cannot prove
    // the caller CONSUMES `rankingEligible`, because reconstruct-from-tier and
    // consume-the-verdict AGREE on every valid input — measured: N-1.18 passed
    // before the fix as well as after. They only disagree when the verdict is forced
    // to contradict the tier, which is what MUT-8 does. This control is the positive
    // witness that pairs with it: reaching survivor promotion is observable here only
    // because this stub cannot satisfy it and therefore throws.
    await drive("auto", { id: BT_ID, status: "completed", tier: "TIER_2", forge_score: 99.9 });
    const w = terminalWrite();
    expect(w.replayStatus).toBe("completed");
    expect(w.replayTier).toBe("TIER_2");
    expect(survivorSelected(), "[auto] a ranking-eligible candidate was never selected as survivor").toBe(true);
  });

  it("N-1.20 [manual] RANKING WITNESS — the manual caller obeys the verdict too", async () => {
    // R-759 §3: the caller-level controls were ASYMMETRIC — seven `[auto]`, one
    // `[manual]`. The manual path was controlled for DELEGATION (N-1.5) and REFUSAL
    // CLEARING (N-1.2) and for nothing else, so a manual-path regression that called
    // the handler and then rebuilt eligibility from `replayTier` would have left both
    // of those GREEN.
    //   `A DELEGATION SPY PROVES THE FUNCTION WAS CALLED; IT DOES NOT PROVE ITS
    //    VERDICT CONTROLLED THE CALLER. CALLED AND OBEYED ARE TWO ASSERTIONS AND ONLY
    //    ONE OF THEM WAS WRITTEN DOWN.`
    // That blind spot is exactly how D-10's last three defects were manufactured:
    // each was copied into BOTH callers and found ONE PATH AT A TIME.
    //
    // ★ Deliberately the SAME observable witness as `N-1.19` — reaching survivor
    //   promotion, visible here because this stub cannot satisfy it and throws.
    //   A different witness would make the two controls incomparable and MUT-9's
    //   two-path result would prove nothing about symmetry.
    await drive("manual", { id: BT_ID, status: "completed", tier: "TIER_2", forge_score: 99.9 });
    const w = terminalWrite();
    expect(w.replayStatus).toBe("completed");
    expect(w.replayTier).toBe("TIER_2");
    expect(survivorSelected(), "[manual] a ranking-eligible candidate was never selected as survivor").toBe(true);
  });
});
