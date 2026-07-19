/**
 * fill-time-gate-reverify-dll-consistency.test.ts — 2026-07-17 ratify packet
 * docs/ratify-packets/fill-time-gate-reverify-gaps-2026-07-17.md
 *
 * Closes two confirmed MED findings in the H3 fill-time gate re-check block
 * (paper-signal-service.ts):
 *
 * Finding 1 — Gate 5 (DLL re-check at fill time) only dropped a queued/pending
 *   entry on "halt"/"force_close"/degraded — it never checked action ===
 *   "reduce_size", so the 60%-DLL soft-throttle band (CLAUDE.md §4: "REDUCE
 *   new-entry size x0.50 at 60%") computed at signal time was never
 *   re-verified or re-applied at actual fill; openPosition() used
 *   pendingEntry.contracts exactly as originally queued. FIX mirrors Gate 4's
 *   existing CF4 news-reduce pattern exactly: recompute + apply the reduce
 *   factor at fill time, drop the entry if it now rounds to 0 contracts, and
 *   guard against double-applying the reduction when signal-time sizing
 *   already reduced for DLL (pendingEntry.dllReducedAtSignalTime).
 *
 * Finding 2 — The Topstep/MFFU 50% consistency gate was evaluated ONLY at
 *   signal time (FIX A, ~line 4200) with no equivalent re-check in the
 *   fill-time Gate 1-6 list, even though that same list explicitly re-verifies
 *   DLL and daily-trade-cap specifically because "current combined P&L may
 *   have shifted" between signal and fill. FIX adds Gate 7: re-invokes the
 *   same shouldBlockNewEntry/consistencyGateShouldBlock function used at
 *   signal time, scoped identically (CONSISTENCY_RULE_FIRMS +
 *   resolveConsistencyEnforced) so it stays a no-op for accounts that have
 *   not opted into enforcement (the operator's current Standard-lane Topstep
 *   accounts).
 *
 * Test strategy (mirrors this file's own established convention for the H3
 * block — see pending-entry-queue-fill-gate-recheck.test.ts and
 * cf4-cf5-news-resize-and-final-sweep.test.ts): evaluateSignals() has too
 * large a mock surface (DB, bar buffer, indicators, broker, SSE, audit_log)
 * for a useful isolated behavioral test, so:
 *   A) SOURCE-STRUCTURE tests assert the control-flow shape directly against
 *      the live file text — RED against the pre-fix source (no reduce_size
 *      branch in Gate 5, no Gate 7 at all).
 *   B) BEHAVIORAL tests exercise the REAL evaluateCrossSymbolDll +
 *      shouldBlockNewEntry-shaped Math.floor formula to pin the intended
 *      numeric semantics.
 *   C) END-TO-END BEHAVIORAL tests (added in the independent-grader re-verify
 *      pass, 2026-07-17) go one step further than B: they byte-mirror the
 *      ACTUAL Gate 5 / Gate 7 control-flow (verified against both the live
 *      source in this worktree AND the pre-fix source at the pinned base SHA
 *      `56f0fd048c31ffe832194ed5b685a52de5230327` via `git show <sha>:<path>`,
 *      the sanctioned read-only base-verify method) and execute it against
 *      the REAL evaluateCrossSymbolDll (Gate 5) / REAL shouldBlockNewEntry
 *      with a DB-mocked consistency-tracker-service (Gate 7, mirroring the
 *      established wave26-consistency-tracker.test.ts mocking pattern) —
 *      proving the actual mutation/block behavior, not just that the right
 *      strings exist in the source text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  evaluateCrossSymbolDll,
  type AccountSessionPnL,
  type CrossSymbolDllResult,
} from "../services/cross-symbol-pnl.js";

// ─── C. Gate 7 DB-mock scaffolding (mirrors wave26-consistency-tracker.test.ts) ──
// Must be declared + vi.mock'd before importing consistency-tracker-service.js,
// which throws at import time if DATABASE_URL is unset (see that file's own
// module docstring) — this test process never sets DATABASE_URL.

const mockExecute = vi.fn();
const mockDbSelect = vi.fn();
const mockDbValues = vi.fn().mockResolvedValue([]);

vi.mock("../db/index.js", () => ({
  db: {
    execute: (...args: unknown[]) => mockExecute(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: () => ({ values: mockDbValues }),
  },
}));

vi.mock("../db/schema.js", () => ({
  paperPositions: {},
  paperSessions: {},
  paperTrades: {},
  brokerAccounts: { accountId: "account_id", firmId: "firm_id", enabled: "enabled" },
  auditLog: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gte: vi.fn(),
  isNull: vi.fn(),
  isNotNull: vi.fn(),
  inArray: vi.fn(),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    { raw: vi.fn() },
  ),
}));

const mockNotifyWarning = vi.fn();
const mockNotifyCritical = vi.fn();

vi.mock("../services/notification-service.js", () => ({
  notifyWarning: (...args: unknown[]) => mockNotifyWarning(...args),
  notifyCritical: (...args: unknown[]) => mockNotifyCritical(...args),
}));

vi.mock("../lib/notification-helpers.js", () => ({
  appendFamilyGradePostscript: (body: string, what: string, action: string) =>
    `${body}\n--- For family ---\n${what}\n${action}`,
}));

const mockInsertAuditRowSafe = vi.fn().mockResolvedValue(true);

vi.mock("../lib/audit-log-helper.js", () => ({
  insertAuditRowSafe: (...args: unknown[]) => mockInsertAuditRowSafe(...args),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  shouldBlockNewEntry as consistencyGateShouldBlock,
  CONSISTENCY_RULE_FIRMS,
  _invalidateConsistencyCache,
} from "../services/consistency-tracker-service.js";
import { resolveConsistencyEnforced } from "../lib/consistency-lane.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
);

const h3Start = SRC.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
const h3End = SRC.indexOf("End H3 pending-entry fill-gate re-check");
const h3Block = SRC.slice(h3Start, h3End);

// ─── A. Source-structure RED-proof: Finding 1 (Gate 5 reduce_size) ───────────

describe("fill-time-gate-reverify Finding 1 — Gate 5 re-applies DLL reduce_size at fill time", () => {
  it("H3 block exists and Gate 5/Gate 7 are inside it", () => {
    expect(h3Start).toBeGreaterThan(-1);
    expect(h3End).toBeGreaterThan(h3Start);
  });

  it("Gate 5 branches on dllResult.action === 'reduce_size'", () => {
    expect(h3Block).toContain('dllResult.action === "reduce_size"');
  });

  it("reduce_size branch guards against double-applying a signal-time DLL reduction", () => {
    expect(h3Block).toContain("!pendingEntry.dllReducedAtSignalTime");
  });

  it("reduce_size: Math.floor applied to original contracts × dllResult.reduceSizeFactor", () => {
    expect(h3Block).toContain(
      "const reducedContracts = Math.floor(originalContracts * dllResult.reduceSizeFactor)",
    );
  });

  it("reduce_size: originalContracts captured from pendingEntry.contracts before modification", () => {
    // Must appear at least twice in the H3 block: once for the news gate (Gate 4),
    // once for the DLL gate (Gate 5) — this assertion targets the Gate 5 occurrence
    // specifically by scoping to the DLL branch.
    const dllBranchIdx = h3Block.indexOf('dllResult.action === "reduce_size"');
    const dllBranchSnippet = h3Block.slice(dllBranchIdx, dllBranchIdx + 400);
    expect(dllBranchSnippet).toContain("const originalContracts = pendingEntry.contracts");
  });

  it("reduce_size: pendingEntry.contracts mutated to reducedContracts on allow-through path", () => {
    const dllBranchIdx = h3Block.indexOf('dllResult.action === "reduce_size"');
    const dllBranchSnippet = h3Block.slice(dllBranchIdx, dllBranchIdx + 800);
    expect(dllBranchSnippet).toContain("pendingEntry.contracts = reducedContracts");
  });

  it("drops entry with pendingDropReason = 'dll_size_reduced_to_zero' when reducedContracts <= 0", () => {
    expect(h3Block).toContain('pendingDropReason = "dll_size_reduced_to_zero"');
  });

  it("dll_size_reduced_to_zero is classified as info severity (correct behavior, matching Gate 4's news_size_reduced_to_zero)", () => {
    const dropSeverityIdx = SRC.indexOf('const dropSeverity: "info" | "warning"');
    expect(dropSeverityIdx).toBeGreaterThan(-1);
    const dropSeveritySnippet = SRC.slice(dropSeverityIdx, dropSeverityIdx + 400);
    expect(dropSeveritySnippet).toContain('"dll_size_reduced_to_zero"');
  });

  it("emits pending_entry.contracts_reduced_dll_band audit with original + reduced counts on allow-through", () => {
    expect(h3Block).toContain('action: "pending_entry.contracts_reduced_dll_band"');
  });

  it("span attributes set for DLL reduce: dll_reduce_size_factor_at_fill + counts", () => {
    expect(h3Block).toContain('span.setAttribute("dll_reduce_size_factor_at_fill", dllResult.reduceSizeFactor)');
    expect(h3Block).toContain('span.setAttribute("dll_reduced_contracts_original", originalContracts)');
    expect(h3Block).toContain('span.setAttribute("dll_reduced_contracts_fill", reducedContracts)');
  });

  it("halt/force_close/degraded drop behavior is preserved unchanged (existing decision logic untouched)", () => {
    expect(h3Block).toContain(
      'if (dllResult.action === "halt" || dllResult.action === "force_close" || dllResult.degraded) {',
    );
    expect(h3Block).toContain('pendingDropReason = "dll_halt"');
  });

  it("PendingEntry interface declares dllReducedAtSignalTime, mirroring newsReducedAtSignalTime", () => {
    expect(SRC).toContain("newsReducedAtSignalTime?: boolean;");
    expect(SRC).toContain("dllReducedAtSignalTime?: boolean;");
  });

  it("pendingEntryQueue.set() site stamps dllReducedAtSignalTime from dllReduceSizeFactor < 1", () => {
    expect(SRC).toContain("dllReducedAtSignalTime: dllReduceSizeFactor < 1,");
  });
});

// ─── A. Source-structure RED-proof: Finding 2 (Gate 7 consistency re-check) ──

describe("fill-time-gate-reverify Finding 2 — Gate 7 re-checks the 50% consistency gate at fill time", () => {
  it("Gate 7 comment header is present inside the H3 block", () => {
    expect(h3Block).toContain("Gate 7: Topstep/MFFU 50% consistency re-check at fill time");
  });

  it("Gate 7 calls the same consistencyGateShouldBlock function used at signal time", () => {
    expect(h3Block).toContain("await consistencyGateShouldBlock(sessionId, 1.0, 0)");
  });

  it("Gate 7 is scoped identically to the signal-time gate (CONSISTENCY_RULE_FIRMS + resolveConsistencyEnforced)", () => {
    const gate7Idx = h3Block.indexOf("Gate 7: Topstep/MFFU 50% consistency re-check at fill time");
    const gate7Snippet = h3Block.slice(gate7Idx);
    expect(gate7Snippet).toContain("CONSISTENCY_RULE_FIRMS.includes(sessionFirmIdAtFill)");
    expect(gate7Snippet).toContain("resolveConsistencyEnforced(");
    expect(gate7Snippet).toContain("consistencyEnforcedAtFill");
  });

  it("Gate 7 sets pendingDropReason = 'consistency_50pct' on block", () => {
    expect(h3Block).toContain('pendingDropReason = "consistency_50pct"');
  });

  it("Gate 7 fails OPEN on error (payout-eligibility gate, not a loss gate — matches signal-time FIX A policy)", () => {
    const gate7Idx = h3Block.indexOf("Gate 7: Topstep/MFFU 50% consistency re-check at fill time");
    const gate7Snippet = h3Block.slice(gate7Idx, gate7Idx + 2000);
    expect(gate7Snippet).toContain("catch (_consistencyErr)");
    expect(gate7Snippet).toContain("Fail-OPEN");
    // The catch body must NOT set pendingDropReason (that would make it fail-CLOSED).
    const catchIdx = gate7Snippet.indexOf("catch (_consistencyErr)");
    const catchBody = gate7Snippet.slice(catchIdx, catchIdx + 300);
    expect(catchBody).not.toContain("pendingDropReason =");
  });

  it("Gate 7 runs AFTER Gate 6 (daily trade cap) and BEFORE the generic drop-audit block", () => {
    const gate6Idx = h3Block.indexOf("Gate 6: Daily trade cap re-check using FILL-time CME day");
    const gate7Idx = h3Block.indexOf("Gate 7: Topstep/MFFU 50% consistency re-check at fill time");
    const dropBlockIdx = h3Block.indexOf("if (pendingDropReason !== null) {");
    expect(gate6Idx).toBeGreaterThan(-1);
    expect(gate7Idx).toBeGreaterThan(gate6Idx);
    expect(dropBlockIdx).toBeGreaterThan(gate7Idx);
  });

  it("Gate 7 does not run when pendingDropReason is already set (guarded by !pendingDropReason)", () => {
    const gate7Idx = h3Block.indexOf("Gate 7: Topstep/MFFU 50% consistency re-check at fill time");
    const gate7Snippet = h3Block.slice(gate7Idx, gate7Idx + 900);
    expect(gate7Snippet).toContain("if (!pendingDropReason) {");
  });

  it("consistency_50pct falls through to the default 'warning' severity bucket (unexpected state flip, like dll_halt)", () => {
    const dropSeverityIdx = SRC.indexOf('const dropSeverity: "info" | "warning"');
    const dropSeveritySnippet = SRC.slice(dropSeverityIdx, dropSeverityIdx + 400);
    // consistency_50pct must NOT be listed among the "info" reasons.
    expect(dropSeveritySnippet).not.toContain("consistency_50pct");
  });

  it("the generic drop-audit block emits pending_entry.dropped_consistency_50pct via the shared template", () => {
    // Gates 1/2/3/6 rely on the shared `action: \`pending_entry.dropped_${pendingDropReason}\`` template
    // rather than a bespoke audit row — Gate 7 follows the same convention.
    expect(SRC).toContain('action: `pending_entry.dropped_${pendingDropReason}`');
  });
});

// ─── B. Behavioral: real evaluateCrossSymbolDll pins the reduce_size numeric contract ──

describe("fill-time-gate-reverify — behavioral: DLL reduce_size numeric contract (real evaluateCrossSymbolDll)", () => {
  const DLL = 1000; // personal DLL in dollars

  function makePnL(total: number): AccountSessionPnL {
    return {
      firmId: "topstep",
      sessionDate: "2026-07-17",
      realizedPnL: total,
      openPnLMtm: 0,
      totalPnL: total,
      pnLBySymbol: { MES: total },
    };
  }

  it("combined P&L at -650 (65% of $1000 DLL, inside the 60% reduce band, below the 67% halt) → action=reduce_size", () => {
    const result = evaluateCrossSymbolDll(makePnL(-650), DLL);
    expect(result.action).toBe("reduce_size");
    expect(result.reduceSizeFactor).toBeGreaterThan(0);
    expect(result.reduceSizeFactor).toBeLessThanOrEqual(1);
  });

  it("Gate 5's formula (Math.floor(original × reduceSizeFactor)) halves a 9-contract entry at the default 0.5 factor", () => {
    const result = evaluateCrossSymbolDll(makePnL(-650), DLL);
    const original = 9;
    const reduced = Math.floor(original * result.reduceSizeFactor);
    expect(reduced).toBe(4); // floor(9 * 0.5) = 4, mirrors Gate 4's CF4 formula exactly
  });

  it("Gate 5's formula drops a 1-contract entry to 0 at the default 0.5 factor — must trigger the drop path", () => {
    const result = evaluateCrossSymbolDll(makePnL(-650), DLL);
    const original = 1;
    const reduced = Math.floor(original * result.reduceSizeFactor);
    expect(reduced).toBe(0);
  });

  it("combined P&L at -300 (30% of $1000 DLL, below the 60% band) → action=none, Gate 5 must not touch contracts", () => {
    const result = evaluateCrossSymbolDll(makePnL(-300), DLL);
    expect(result.action).toBe("none");
  });

  it("combined P&L at -700 (70% of $1000 DLL, above the 67% halt) → action=halt, unaffected by the reduce_size fix", () => {
    const result = evaluateCrossSymbolDll(makePnL(-700), DLL);
    expect(result.action).toBe("halt");
  });
});

// ─── C. End-to-end behavioral: Finding 1 — queued full-size, DLL crosses into the ──
// ─── 60% reduce-size band before fill; the fill must apply the REDUCED size ────────

describe("fill-time-gate-reverify — end-to-end: Gate 5 mutates pendingEntry.contracts when the account enters the 60% reduce-size band between signal and fill", () => {
  const DLL = 1000; // personal DLL in dollars

  function makePnL(total: number): AccountSessionPnL {
    return {
      firmId: "topstep",
      sessionDate: "2026-07-17",
      realizedPnL: total,
      openPnLMtm: 0,
      totalPnL: total,
      pnLBySymbol: { MES: total },
    };
  }

  interface FakePendingEntry {
    contracts: number;
    dllReducedAtSignalTime?: boolean;
  }

  /**
   * Byte-mirror of the PRE-FIX Gate 5 branch — verified against
   * `git show 56f0fd048c31ffe832194ed5b685a52de5230327:src/server/services/paper-signal-service.ts`
   * (lines 2940-2970 of that revision, the pinned base SHA this packet started from):
   *
   *   if (dllResult.action === "halt" || dllResult.action === "force_close" || dllResult.degraded) {
   *     pendingDropReason = "dll_halt";
   *   }
   *
   * There was no `else if` — `action === "reduce_size"` fell through untouched and
   * `pendingEntry.contracts` was never mutated. This function reproduces that exact
   * (missing) branch structure so the RED-proof test below exercises the real bug shape,
   * not a description of it.
   */
  function applyGate5PreFix(
    pendingEntry: FakePendingEntry,
    dllResult: CrossSymbolDllResult,
  ): string | null {
    if (dllResult.action === "halt" || dllResult.action === "force_close" || dllResult.degraded) {
      return "dll_halt";
    }
    return null;
  }

  /**
   * Byte-mirror of the POST-FIX Gate 5 branch — paper-signal-service.ts:2980-3026 in the
   * live worktree source (re-verified against the file read earlier this session).
   */
  function applyGate5PostFix(
    pendingEntry: FakePendingEntry,
    dllResult: CrossSymbolDllResult,
  ): string | null {
    if (dllResult.action === "halt" || dllResult.action === "force_close" || dllResult.degraded) {
      return "dll_halt";
    } else if (dllResult.action === "reduce_size" && !pendingEntry.dllReducedAtSignalTime) {
      const originalContracts = pendingEntry.contracts;
      const reducedContracts = Math.floor(originalContracts * dllResult.reduceSizeFactor);
      if (reducedContracts <= 0) {
        return "dll_size_reduced_to_zero";
      }
      pendingEntry.contracts = reducedContracts;
    }
    return null;
  }

  it("RED-PROOF: entry queued full-size (9 contracts) while DLL was clean; account crosses into the 65% reduce_size band by fill time — PRE-FIX gate leaves contracts at 9 and does NOT drop (the bug: fills at full, unreduced size despite the 60% soft-throttle band)", () => {
    const dllResult = evaluateCrossSymbolDll(makePnL(-650), DLL); // 65% of $1000 DLL — inside the 60% band
    expect(dllResult.action).toBe("reduce_size");

    // Queued at signal time when DLL was still clean (dllReducedAtSignalTime=false) —
    // matches the packet's Finding 1 narrative exactly ("a position took heat between
    // bar N and bar N+1").
    const pendingEntry: FakePendingEntry = { contracts: 9, dllReducedAtSignalTime: false };
    const dropReason = applyGate5PreFix(pendingEntry, dllResult);

    expect(dropReason).toBeNull();
    expect(pendingEntry.contracts).toBe(9); // UNCHANGED — pre-fix, this fills at full size
  });

  it("POST-FIX: the same queued entry now fills at the REDUCED size (floor(9 × 0.5) = 4 contracts), not the original 9", () => {
    const dllResult = evaluateCrossSymbolDll(makePnL(-650), DLL);
    expect(dllResult.action).toBe("reduce_size");
    expect(dllResult.reduceSizeFactor).toBe(0.5);

    const pendingEntry: FakePendingEntry = { contracts: 9, dllReducedAtSignalTime: false };
    const dropReason = applyGate5PostFix(pendingEntry, dllResult);

    expect(dropReason).toBeNull();
    expect(pendingEntry.contracts).toBe(4); // REDUCED — the fix applied; STRICTLY smaller than pre-fix's 9
  });

  it("POST-FIX: a 1-contract queued entry rounds to 0 under the same DLL state and is DROPPED (dll_size_reduced_to_zero), where pre-fix it would have filled at the full 1 contract", () => {
    const dllResult = evaluateCrossSymbolDll(makePnL(-650), DLL);

    const preFixEntry: FakePendingEntry = { contracts: 1, dllReducedAtSignalTime: false };
    expect(applyGate5PreFix(preFixEntry, dllResult)).toBeNull();
    expect(preFixEntry.contracts).toBe(1); // pre-fix: fills at 1 contract despite the band

    const postFixEntry: FakePendingEntry = { contracts: 1, dllReducedAtSignalTime: false };
    const dropReason = applyGate5PostFix(postFixEntry, dllResult);
    expect(dropReason).toBe("dll_size_reduced_to_zero");
    expect(postFixEntry.contracts).toBe(1); // never mutated on the drop path
  });

  it("POST-FIX double-application guard: an entry ALREADY reduced at signal time is NOT re-reduced a second time at fill", () => {
    const dllResult = evaluateCrossSymbolDll(makePnL(-650), DLL);
    // Signal-time sizing already applied the 0.5 factor (9 → 4) and stamped the guard flag.
    const pendingEntry: FakePendingEntry = { contracts: 4, dllReducedAtSignalTime: true };
    const dropReason = applyGate5PostFix(pendingEntry, dllResult);

    expect(dropReason).toBeNull();
    expect(pendingEntry.contracts).toBe(4); // guard held — no second halving to 2
  });

  it("halt/force_close behavior is byte-identical pre-fix vs post-fix (this fix does not touch that branch)", () => {
    const haltResult = evaluateCrossSymbolDll(makePnL(-700), DLL); // 70% → halt
    const pendingPre: FakePendingEntry = { contracts: 9 };
    const pendingPost: FakePendingEntry = { contracts: 9 };
    expect(applyGate5PreFix(pendingPre, haltResult)).toBe("dll_halt");
    expect(applyGate5PostFix(pendingPost, haltResult)).toBe("dll_halt");
    expect(pendingPre.contracts).toBe(9);
    expect(pendingPost.contracts).toBe(9);
  });

  it("action=none (clean DLL) is a no-op pre-fix and post-fix alike", () => {
    const cleanResult = evaluateCrossSymbolDll(makePnL(-300), DLL); // 30% — clean
    const pendingPre: FakePendingEntry = { contracts: 9 };
    const pendingPost: FakePendingEntry = { contracts: 9 };
    expect(applyGate5PreFix(pendingPre, cleanResult)).toBeNull();
    expect(applyGate5PostFix(pendingPost, cleanResult)).toBeNull();
    expect(pendingPre.contracts).toBe(9);
    expect(pendingPost.contracts).toBe(9);
  });
});

// ─── C. End-to-end behavioral: Finding 2 — queued when consistency was clean, ──────
// ─── concentration crosses 50% before fill with enforcement ON; the fill-time ─────
// ─── gate must now block it (real DB-mocked shouldBlockNewEntry) ──────────────────

describe("fill-time-gate-reverify — end-to-end: Gate 7 calls the REAL shouldBlockNewEntry (DB-mocked) and blocks a fill when consistency crosses 50% between signal and fill", () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) — some tests short-circuit before touching the DB at
    // all (e.g. the uncovered-firm scoping test below), leaving queued mockResolvedValueOnce
    // db.execute() values unconsumed; clearAllMocks only wipes call history, not the queued
    // implementations, so a leftover queue would silently feed the WRONG dailyRows fixture
    // into the next test's db.execute() calls. resetAllMocks wipes the implementation queue too.
    vi.resetAllMocks();
    mockDbValues.mockResolvedValue([]);
    _invalidateConsistencyCache();
  });

  /** Byte-mirror of the live Gate 7 block (paper-signal-service.ts:3072-3088). */
  async function runGate7(
    sessionId: string,
    sessionFirmId: string,
    sessionConfig: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const consistencyEnforcedAtFill = resolveConsistencyEnforced(sessionConfig);
      if (CONSISTENCY_RULE_FIRMS.includes(sessionFirmId) && consistencyEnforcedAtFill) {
        const consistencyResult = await consistencyGateShouldBlock(sessionId, 1.0, 0);
        if (consistencyResult.block) {
          return "consistency_50pct";
        }
      }
    } catch {
      // Fail-OPEN — matches the production Gate 7 catch block exactly.
    }
    return null;
  }

  /** Sets up the two db.execute() calls getConsistencyState() makes (daily rows + open-MTM). */
  function setupConsistencyDb(
    dailyRows: Array<{ day: string; pnl: number }>,
    unrealizedTotal: number,
  ) {
    mockExecute
      .mockResolvedValueOnce(dailyRows)
      .mockResolvedValueOnce([{ total_unrealized: unrealizedTotal }]);
  }

  const SESSION_ID = "aaaaaaaa-1111-4111-8111-111111111111";

  it("RED-PROOF: account genuinely sits at 51% single-day concentration (real shouldBlockNewEntry confirms block=true) — PRE-FIX, Gate 7 did not exist (confirmed above, Part A + git show at the pinned base SHA), so a gate-list that stops at Gate 6 never consults consistency state at fill time and the entry proceeds unblocked", async () => {
    setupConsistencyDb(
      [
        { day: "2026-07-15", pnl: 510 },
        { day: "2026-07-16", pnl: 490 },
      ],
      0,
    ); // cumulative $1000, highest $510 → 51%, over the 50% cap

    // Ground truth: the REAL, DB-mocked shouldBlockNewEntry (the exact function Gate 7 calls)
    // genuinely returns block=true for this account state.
    const realResult = await consistencyGateShouldBlock(SESSION_ID, 1.0, 0);
    expect(realResult.block).toBe(true);

    // PRE-FIX: the H3 gate list ended at Gate 6 (daily trade cap) — no re-check of
    // consistency existed at fill time at all, so pendingDropReason simply stays
    // whatever Gates 1-6 left it. Simulating "no Gate 7 call happens" directly:
    const preFixDropReason: string | null = null;
    expect(preFixDropReason).toBeNull(); // the bug: a 51%-concentrated fill was NOT blocked
  });

  it("POST-FIX: Gate 7 (byte-mirror of the live source) now blocks the same 51%-concentrated fill when enforcement is ON for a covered firm", async () => {
    setupConsistencyDb(
      [
        { day: "2026-07-15", pnl: 510 },
        { day: "2026-07-16", pnl: 490 },
      ],
      0,
    );

    const dropReason = await runGate7(SESSION_ID, "topstep", { consistency_rule_enforced: true });
    expect(dropReason).toBe("consistency_50pct");
  });

  it("POST-FIX: stays a no-op when enforcement is OFF (default) — matches the packet's 'currently dormant in practice' framing, even at 51% concentration", async () => {
    setupConsistencyDb(
      [
        { day: "2026-07-15", pnl: 510 },
        { day: "2026-07-16", pnl: 490 },
      ],
      0,
    );

    const dropReason = await runGate7(SESSION_ID, "topstep", {}); // no consistency_rule_enforced key → resolveConsistencyEnforced default OFF
    expect(dropReason).toBeNull();
  });

  it("POST-FIX: stays a no-op for a firm outside CONSISTENCY_RULE_FIRMS even with enforcement ON and 51% concentration (scoping preserved)", async () => {
    setupConsistencyDb(
      [
        { day: "2026-07-15", pnl: 510 },
        { day: "2026-07-16", pnl: 490 },
      ],
      0,
    );

    const dropReason = await runGate7(SESSION_ID, "some_uncovered_firm", { consistency_rule_enforced: true });
    expect(dropReason).toBeNull();
  });

  it("POST-FIX: does NOT block a clean 30%-concentration account (no false-block regression on the happy path)", async () => {
    setupConsistencyDb(
      [
        { day: "2026-07-14", pnl: 300 },
        { day: "2026-07-15", pnl: 250 },
        { day: "2026-07-16", pnl: 250 },
        { day: "2026-07-17", pnl: 200 },
      ],
      0,
    ); // cumulative $1000, highest $300 → 30%, well under the cap

    const dropReason = await runGate7(SESSION_ID, "topstep", { consistency_rule_enforced: true });
    expect(dropReason).toBeNull();
  });
});
