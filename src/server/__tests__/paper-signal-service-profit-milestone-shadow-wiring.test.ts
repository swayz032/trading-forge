/**
 * paper-signal-service-profit-milestone-shadow-wiring.test.ts
 *
 * Wave 6 ($250-1K campaign) — source-code analysis tests for the shadow (observability-
 * only, never-enforcing) profit-milestone governor wired into paper-signal-service.ts.
 *
 * Source analysis is the established pattern for this exact function in this codebase
 * (see paper-signal-service-deepscan-findings.test.ts's F1/F2 tests): evaluateSignals()
 * has too many DB/gateway dependencies to build a full behavioral harness cheaply, so
 * structural assertions against the source text directly verify the safety invariants
 * this wave's negative claims depend on — most importantly, that the shadow governor's
 * result NEVER reaches `lockoutBlocked` (or any gate derived from it) and NEVER touches
 * exit/close logic, even on internal failure.
 *
 * The pure decision ALGORITHM (zone boundaries, dedup transition logic, env/lane
 * precedence) is covered with real behavioral tests in
 * src/server/lib/__tests__/profit-milestone-shadow.test.ts — this file only proves the
 * WIRING calls that exact algorithm correctly and never leaks its result into a blocking
 * or exit-side path.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Normalize CRLF -> LF: this repo's source files are checked out with Windows line
// endings, which would otherwise break the multi-line literal substring matches below.
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-signal-service.ts"),
  "utf-8",
).replace(/\r\n/g, "\n");

// Isolate the shadow-governor block precisely: from its section marker up to (but not
// including) the start of the pre-existing Tier 5.3 lockout-DB-query try block that
// immediately follows it, so every assertion below is scoped to code this wave actually
// added — not the whole file, and not the pre-existing lockout gate it sits in front of.
const BLOCK_START_MARKER = "Wave 6 ($250-1K campaign) — Shadow Profit-Milestone Governor";
const BLOCK_END_MARKER = "const activeLockout = await getActiveLockout(sessionConfig.strategyId);";

function extractShadowGovernorBlock(): string {
  const startIdx = SRC.indexOf(BLOCK_START_MARKER);
  expect(startIdx).toBeGreaterThan(-1);
  const endIdx = SRC.indexOf(BLOCK_END_MARKER, startIdx);
  expect(endIdx).toBeGreaterThan(startIdx);
  return SRC.slice(startIdx, endIdx);
}

/** Strip full-line `//` comments — isolates actual CODE from prose that legitimately
 * names other gates/functions for documentation purposes (e.g. this wave's own doc
 * comments explicitly name `lockoutBlocked`/`correlatedBlocked`/etc. to explain what
 * must NEVER be touched — that prose reference is not a code reference). */
function stripLineComments(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe("Wave 6 wiring — import + module surface", () => {
  it("imports evaluateProfitMilestone, resolveProfitMilestoneShadowEnabled, and decideProfitMilestoneTransition from the pure module", () => {
    expect(SRC).toContain(
      'import { evaluateProfitMilestone, resolveProfitMilestoneShadowEnabled, decideProfitMilestoneTransition, type ProfitMilestoneZone } from "../lib/profit-milestone-shadow.js"',
    );
  });
});

describe("Wave 6 wiring — the shadow governor block never touches lockoutBlocked or any derived gate", () => {
  it("the block does not assign into lockoutBlocked", () => {
    const block = extractShadowGovernorBlock();
    expect(block).not.toMatch(/\blockoutBlocked\s*=/);
  });

  it("the block's CODE (comments stripped) does not reference correlatedBlocked, crossAccountHedgeBlocked, priceLockBlocked, or antiSetupBlocked", () => {
    // The block's own doc comment legitimately NAMES these gates in prose to explain
    // what must never be touched — that's documentation, not a code reference. Strip
    // full-line comments first so this assertion checks actual code, not prose about it.
    const code = stripLineComments(extractShadowGovernorBlock());
    for (const gate of ["correlatedBlocked", "crossAccountHedgeBlocked", "priceLockBlocked", "antiSetupBlocked"]) {
      expect(code).not.toContain(gate);
    }
  });

  it("the block is placed AFTER the lockoutBlocked aggregation line and BEFORE the lockout DB gate", () => {
    const aggIdx = SRC.indexOf(
      "let lockoutBlocked = symbolWhitelistBlocked || blackoutBlocked || dllHaltBlocked || dailyTradeCapBlocked || lunchBlackoutBlocked || consistencyBlocked;",
    );
    const blockIdx = SRC.indexOf(BLOCK_START_MARKER);
    const lockoutGateIdx = SRC.indexOf(BLOCK_END_MARKER);
    expect(aggIdx).toBeGreaterThan(-1);
    expect(blockIdx).toBeGreaterThan(aggIdx);
    expect(lockoutGateIdx).toBeGreaterThan(blockIdx);
  });
});

describe("Wave 6 wiring — never touches exit/close logic", () => {
  it("the block's CODE (comments stripped) does not reference any exit/close/position function", () => {
    const block = stripLineComments(extractShadowGovernorBlock());
    const forbidden = [
      "applyExitDecision",
      "bookPartialClose",
      "closePosition",
      "forceCloseAllPositions",
      "openPosition(",
      "stop-breach",
      "checkStopLoss",
    ];
    for (const token of forbidden) {
      expect(block).not.toContain(token);
    }
  });
});

describe("Wave 6 wiring — enablement gate skips entirely when disabled", () => {
  it("calls resolveProfitMilestoneShadowEnabled before doing any evaluation work", () => {
    const block = extractShadowGovernorBlock();
    const resolveIdx = block.indexOf("resolveProfitMilestoneShadowEnabled(");
    const evalIdx = block.indexOf("evaluateProfitMilestone(");
    expect(resolveIdx).toBeGreaterThan(-1);
    expect(evalIdx).toBeGreaterThan(-1);
    expect(resolveIdx).toBeLessThan(evalIdx);
  });

  it("gates the evaluation + audit + SSE inside an `if (profitMilestoneShadowEnabled)` block", () => {
    const block = extractShadowGovernorBlock();
    expect(block).toContain("if (profitMilestoneShadowEnabled) {");
  });
});

describe("Wave 6 wiring — fail-open on evaluator throw", () => {
  it("wraps the evaluator call in its own inner try/catch", () => {
    const block = extractShadowGovernorBlock();
    const tryIdx = block.indexOf("try {");
    const catchIdx = block.indexOf("catch (milestoneErr)");
    expect(tryIdx).toBeGreaterThan(-1);
    expect(catchIdx).toBeGreaterThan(tryIdx);
  });

  it("the catch block never assigns lockoutBlocked and never re-throws", () => {
    const block = extractShadowGovernorBlock();
    const catchIdx = block.indexOf("catch (milestoneErr)");
    const catchBlockEnd = block.indexOf("} catch (resolveErr)");
    expect(catchIdx).toBeGreaterThan(-1);
    expect(catchBlockEnd).toBeGreaterThan(catchIdx);
    const catchBody = block.slice(catchIdx, catchBlockEnd);
    expect(catchBody).not.toMatch(/\blockoutBlocked\s*=/);
    expect(catchBody).not.toContain("throw ");
  });

  it("the catch block logs a warning via logger.warn", () => {
    const block = extractShadowGovernorBlock();
    const catchIdx = block.indexOf("catch (milestoneErr)");
    const window = block.slice(catchIdx, catchIdx + 700);
    expect(window).toContain("logger.warn");
  });

  it("the catch block writes a warning-status audit row documenting the fail-open", () => {
    const block = extractShadowGovernorBlock();
    const catchIdx = block.indexOf("catch (milestoneErr)");
    const catchBlockEnd = block.indexOf("} catch (resolveErr)");
    const catchBody = block.slice(catchIdx, catchBlockEnd);
    expect(catchBody).toContain('action: "profit_governor.shadow_would_block"');
    expect(catchBody).toContain('status: "warning"');
    expect(catchBody).toContain("failOpen: true");
  });

  it("the catch block does NOT call broadcastSSE (no SSE fires on a failed evaluation)", () => {
    const block = extractShadowGovernorBlock();
    const catchIdx = block.indexOf("catch (milestoneErr)");
    const catchBlockEnd = block.indexOf("} catch (resolveErr)");
    const catchBody = block.slice(catchIdx, catchBlockEnd);
    expect(catchBody).not.toContain("broadcastSSE(");
  });

  it("the OUTER catch (resolveErr) also never touches lockoutBlocked and never re-throws", () => {
    const block = extractShadowGovernorBlock();
    const outerCatchIdx = block.indexOf("catch (resolveErr)");
    expect(outerCatchIdx).toBeGreaterThan(-1);
    const outerCatchBody = block.slice(outerCatchIdx);
    expect(outerCatchBody).not.toMatch(/\blockoutBlocked\s*=/);
    expect(outerCatchBody).not.toContain("throw ");
  });
});

describe("Wave 6 wiring — audit row + SSE shape on the happy path", () => {
  it("uses the exact audit action string profit_governor.shadow_would_block", () => {
    const block = extractShadowGovernorBlock();
    expect(block).toContain('action: "profit_governor.shadow_would_block"');
  });

  it("entityType is paper_session and decisionAuthority is system", () => {
    const block = extractShadowGovernorBlock();
    expect(block).toContain('entityType: "paper_session"');
    expect(block).toContain('decisionAuthority: "system"');
  });

  it("wouldBlock is permanently false in the result payload (structural non-enforcement contract)", () => {
    const block = extractShadowGovernorBlock();
    expect(block).toContain("wouldBlock: false");
    // Must never be conditionally true anywhere in this block.
    expect(block).not.toMatch(/wouldBlock:\s*(true|milestoneResult|transition)/);
  });

  it("broadcasts profit_governor:shadow_milestone with sessionId, zone, and sessionPnl", () => {
    const block = extractShadowGovernorBlock();
    expect(block).toContain('broadcastSSE("profit_governor:shadow_milestone"');
    const sseIdx = block.indexOf('broadcastSSE("profit_governor:shadow_milestone"');
    const sseCallWindow = block.slice(sseIdx, sseIdx + 200);
    expect(sseCallWindow).toContain("sessionId");
    expect(sseCallWindow).toContain("zone");
    expect(sseCallWindow).toContain("sessionPnl");
  });

  it("calls insertAuditRow exactly twice (happy-path transition + fail-open catch), both non-blocking", () => {
    const block = extractShadowGovernorBlock();
    const insertAuditRowCalls = block.split("insertAuditRow({").length - 1;
    expect(insertAuditRowCalls).toBe(2);
    // Each insertAuditRow(...) call is chained with a non-blocking .catch that records the
    // metric — appears once per call site (2 total).
    const nonBlockingCatches = block.split(
      'auditWriteFailuresTotal.labels({ action: "profit_governor.shadow_would_block" }).inc()',
    ).length - 1;
    expect(nonBlockingCatches).toBe(2);
  });
});

describe("Wave 6 wiring — de-dup uses the shared per-session governor state, not a per-bar flag", () => {
  it("reads/writes gov.lastProfitMilestoneZone via getGovernorState(sessionId)", () => {
    const block = extractShadowGovernorBlock();
    expect(block).toContain("getGovernorState(sessionId)");
    expect(block).toContain("gov.lastProfitMilestoneZone");
  });

  it("delegates the transition/de-dup decision to decideProfitMilestoneTransition (not inlined ad hoc logic)", () => {
    const block = extractShadowGovernorBlock();
    expect(block).toContain("decideProfitMilestoneTransition(gov.lastProfitMilestoneZone, milestoneResult.zone)");
  });
});

describe("GovernorSessionState — lastProfitMilestoneZone resets alongside sessionPnl", () => {
  it("is initialized to null in getGovernorState's fresh-state constructor", () => {
    const initIdx = SRC.indexOf('state = {\n      state: "normal",');
    expect(initIdx).toBeGreaterThan(-1);
    const window = SRC.slice(initIdx, initIdx + 300);
    expect(window).toContain("lastProfitMilestoneZone: null");
  });

  it("is reset to null in the P0-4 session-restore path (restoredState)", () => {
    const restoreIdx = SRC.indexOf("const restoredState: GovernorSessionState = {");
    expect(restoreIdx).toBeGreaterThan(-1);
    const window = SRC.slice(restoreIdx, restoreIdx + 600);
    expect(window).toContain("lastProfitMilestoneZone: null");
  });

  it("is reset to null in governorOnSessionEnd alongside sessionPnl/sessionTrades", () => {
    const fnIdx = SRC.indexOf("export function governorOnSessionEnd(sessionId: string): void {");
    expect(fnIdx).toBeGreaterThan(-1);
    const window = SRC.slice(fnIdx, fnIdx + 800);
    expect(window).toContain("gov.sessionPnl = 0");
    expect(window).toContain("gov.lastProfitMilestoneZone = null");
  });
});
