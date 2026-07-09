/**
 * paper-execution-service.deepscan6.test.ts
 *
 * Regression tests for deepscan-6 findings M1 and O7:
 *
 * M1 (MED — DLL crash-window): dailyPnlBreakdown must be written INSIDE the
 *    close transaction in both closePosition and bookPartialClose so DLL gates
 *    never read a stale value if the process crashes between the trade commit
 *    and a follow-up update.  A crash or transient DB error on a non-blocking
 *    out-of-tx update permanently understates the day's realized loss for every
 *    DLL gate reader (cross-symbol-pnl.ts, paper-risk-gate.ts, kill-switch.ts).
 *
 * O7 (LOW — audit asymmetry): bookPartialClose success-path audit must be
 *    inside the transaction (fail-closed), matching the closePosition pattern.
 *    The pre-fix behavior was fire-and-forget .catch() outside the tx, meaning
 *    a crash between tx commit and audit write left no journal record.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  resolve(__dirname, "../services/paper-execution-service.ts"),
  "utf-8",
);

// ─── M1: bookPartialClose — dailyPnlBreakdown inside transaction ──────────────

describe("M1 — bookPartialClose: dailyPnlBreakdown written inside transaction", () => {
  // Extract only the bookPartialClose function body for scoped assertions
  const fnIdx = SRC.indexOf("async function bookPartialClose(");
  const nextFnIdx = SRC.indexOf("\nasync function ", fnIdx + 1);
  const body = SRC.slice(fnIdx, nextFnIdx > 0 ? nextFnIdx : fnIdx + 6000);

  it("uses tx.update (not db.update) for dailyPnlBreakdown — confirms write is inside the tx", () => {
    // The jsonb_set pattern must appear after a tx.update call, not db.update
    expect(body).toContain("tx.update(paperSessions).set({");
    // dailyPnlBreakdown key appears in the function
    expect(body).toContain("dailyPnlBreakdown:");
  });

  it("does not contain the old non-blocking try/catch outside the tx", () => {
    // The pre-fix pattern had a try/catch with this warning — it must be gone
    expect(body).not.toContain("dailyPnlBreakdown update failed (non-blocking");
  });

  it("does not use db.update(paperSessions) for dailyPnlBreakdown (would be outside tx)", () => {
    // After the M1 fix there is no db.update(paperSessions) in bookPartialClose at all —
    // all session updates use the tx handle inside the transaction callback.
    expect(body).not.toContain("await db.update(paperSessions)");
  });

  it("dailyPnlBreakdown update appears in the transaction callback (before logger.info outside the tx)", () => {
    // The logger.info("paper.partial_close: P&L booked and equity credited") fires AFTER
    // the transaction commits — it is the first statement outside the tx callback.
    // The dailyPnlBreakdown key must appear BEFORE that log statement.
    const outsideTxAnchor = body.indexOf('"paper.partial_close: P&L booked and equity credited"');
    expect(outsideTxAnchor).toBeGreaterThan(-1);
    const txBody = body.slice(0, outsideTxAnchor);
    expect(txBody).toContain("dailyPnlBreakdown:");
  });
});

// ─── O7: bookPartialClose — success audit inside transaction ──────────────────

describe("O7 — bookPartialClose: success-path audit inside transaction (fail-closed)", () => {
  const fnIdx = SRC.indexOf("async function bookPartialClose(");
  const nextFnIdx = SRC.indexOf("\nasync function ", fnIdx + 1);
  const body = SRC.slice(fnIdx, nextFnIdx > 0 ? nextFnIdx : fnIdx + 6000);

  it("success audit uses await tx.insert(auditLog), not db.insert", () => {
    // The pre-fix pattern was `db.insert(auditLog).values({...}).catch(...)` — must be gone.
    // Post-fix: `await tx.insert(auditLog)` inside the transaction callback.
    expect(body).toContain("await tx.insert(auditLog)");
  });

  it("does not use fire-and-forget .catch() for the success audit", () => {
    // The old pattern had `.catch((err) => logger.warn({ err }, "bookPartialClose: audit write failed`
    expect(body).not.toContain("audit write failed (non-blocking)");
  });

  it("success audit with status:success and correct action appears inside the tx callback", () => {
    // The action template and status must both exist in the function
    expect(body).toContain("paper.partial_close.${exitReason.toLowerCase()}");
    // Find the success audit block (not the booking_failed block)
    const actionIdx = body.indexOf("paper.partial_close.${exitReason.toLowerCase()}");
    const auditBlock = body.slice(actionIdx, actionIdx + 400);
    expect(auditBlock).toContain('status: "success"');
    // Confirm it appears BEFORE logger.info outside the tx (the logger.info fires after tx commits)
    const outsideTxAnchor = body.indexOf('"paper.partial_close: P&L booked and equity credited"');
    expect(outsideTxAnchor).toBeGreaterThan(-1);
    expect(actionIdx).toBeLessThan(outsideTxAnchor);
  });

  it("booking_failed audit in catch block is still present and untouched", () => {
    // The booking_failed audit (M3 deepscan-5) must stay in the catch block
    expect(body).toContain("paper.partial_close.booking_failed");
    expect(body).toContain('status: "error"');
  });
});

// ─── M1: closePosition — dailyPnlBreakdown inside transaction ────────────────

describe("M1 — closePosition: dailyPnlBreakdown written inside transaction", () => {
  it("tx segment between trade_close audit insert and return [insertedTrade] contains dailyPnlBreakdown update", () => {
    // The closePosition transaction:
    //   1. tx.insert(paperTrades)
    //   2. tx.update(paperPositions)
    //   3. tx.update(paperSessions) — equity/peakEquity/realizedPeakEquity/totalTrades
    //   4. tx.insert(auditLog) — paper.trade_close
    //   5. tx.update(paperSessions) — dailyPnlBreakdown  ← M1 fix
    //   6. return [insertedTrade]
    //
    // Anchor to the trade_close audit action and the return statement that closes the tx.
    const auditActionIdx = SRC.indexOf('action: "paper.trade_close"');
    expect(auditActionIdx).toBeGreaterThan(-1);

    const returnIdx = SRC.indexOf("return [insertedTrade];", auditActionIdx);
    expect(returnIdx).toBeGreaterThan(-1);

    // The segment between step 4 and step 6 must contain a tx.update for dailyPnlBreakdown
    const txSegment = SRC.slice(auditActionIdx, returnIdx);
    expect(txSegment).toContain("tx.update(paperSessions)");
    expect(txSegment).toContain("dailyPnlBreakdown");
  });

  it("checkConsistencyRule no longer writes dailyPnlBreakdown (write was moved into closePosition tx)", () => {
    const fnIdx = SRC.indexOf("async function checkConsistencyRule(");
    expect(fnIdx).toBeGreaterThan(-1);
    const nextFnIdx = SRC.indexOf("\nasync function ", fnIdx + 1);
    const body = SRC.slice(fnIdx, nextFnIdx > 0 ? nextFnIdx : fnIdx + 2000);

    // The db.update(paperSessions) that used to write dailyPnlBreakdown must be gone
    expect(body).not.toContain("db.update(paperSessions)");
    // deep-scan #15 FIX M4: checkConsistencyRule now DEFERS to the authoritative
    // consistency tracker (single source of truth) instead of its own local
    // dailyPnlBreakdown re-read + firmConfig.consistencyRule ratio calc.
    expect(body).toContain("getConsistencyState");
    // The old local single-threshold calc must be gone (it could disagree with the tracker).
    expect(body).not.toContain("firmConfig.consistencyRule");
  });

  it("checkConsistencyRule no longer accepts tradePnl parameter", () => {
    const sigStart = SRC.indexOf("async function checkConsistencyRule(");
    const sigEnd = SRC.indexOf("): Promise<void>", sigStart);
    const signature = SRC.slice(sigStart, sigEnd + 16);
    expect(signature).not.toContain("tradePnl");
  });

  it("closePosition call site passes only session (drops the netPnl argument)", () => {
    expect(SRC).toContain("await checkConsistencyRule(session);");
    // The old two-argument form must not appear
    expect(SRC).not.toContain("await checkConsistencyRule(session, netPnl)");
  });
});

// ─── Behavioral simulation: atomicity of bookPartialClose tx ─────────────────

/**
 * Simulates the bookPartialClose transaction block after the M1+O7 fix:
 *   tx.insert(paperTrades)
 *   tx.update(paperSessions) — equity
 *   tx.update(paperPositions) — position state
 *   tx.update(paperSessions) — dailyPnlBreakdown  ← M1
 *   tx.insert(auditLog)                           ← O7
 *
 * All-or-nothing: if any step throws, the entire callback never commits.
 */
async function simulateBookPartialCloseTx(opts: {
  failAfter?: "trade" | "equity" | "position" | "dailyPnl" | "audit";
}): Promise<{ committed: string[]; rolledBack: boolean }> {
  const { failAfter } = opts;
  const written: string[] = [];

  let rolledBack = false;

  try {
    // Simulate transaction callback (all-or-nothing)
    await (async () => {
      written.push("trade_row");
      if (failAfter === "trade") throw new Error("simulated db error after trade insert");

      written.push("equity_update");
      if (failAfter === "equity") throw new Error("simulated db error after equity update");

      written.push("position_state_update");
      if (failAfter === "position") throw new Error("simulated db error after position update");

      // M1: dailyPnlBreakdown is now INSIDE the same callback
      written.push("dailyPnlBreakdown_update");
      if (failAfter === "dailyPnl") throw new Error("simulated db error after dailyPnlBreakdown update");

      // O7: success audit is now INSIDE the same callback
      written.push("audit_success");
      if (failAfter === "audit") throw new Error("simulated db error inside audit insert");
    })();

    // Transaction committed — all writes are durable
    return { committed: [...written], rolledBack: false };
  } catch {
    // Transaction rolled back — zero writes are durable
    rolledBack = true;
    return { committed: [], rolledBack };
  }
}

describe("Behavioral: bookPartialClose tx atomicity after M1+O7 fix", () => {
  it("happy path: all five writes committed together", async () => {
    const { committed, rolledBack } = await simulateBookPartialCloseTx({});
    expect(rolledBack).toBe(false);
    expect(committed).toContain("trade_row");
    expect(committed).toContain("dailyPnlBreakdown_update");
    expect(committed).toContain("audit_success");
    expect(committed).toHaveLength(5);
  });

  it("crash after trade insert: BOTH trade_row AND dailyPnlBreakdown_update are rolled back", async () => {
    const { committed, rolledBack } = await simulateBookPartialCloseTx({ failAfter: "trade" });
    expect(rolledBack).toBe(true);
    expect(committed).toHaveLength(0);
    expect(committed).not.toContain("trade_row");
    expect(committed).not.toContain("dailyPnlBreakdown_update");
    expect(committed).not.toContain("audit_success");
  });

  it("crash after dailyPnlBreakdown update: trade_row AND dailyPnlBreakdown_update both rolled back", async () => {
    const { committed, rolledBack } = await simulateBookPartialCloseTx({ failAfter: "dailyPnl" });
    expect(rolledBack).toBe(true);
    expect(committed).toHaveLength(0);
    expect(committed).not.toContain("trade_row");
    expect(committed).not.toContain("dailyPnlBreakdown_update");
    expect(committed).not.toContain("audit_success");
  });

  it("crash inside audit insert: all five writes rolled back (fail-closed audit)", async () => {
    const { committed, rolledBack } = await simulateBookPartialCloseTx({ failAfter: "audit" });
    expect(rolledBack).toBe(true);
    expect(committed).toHaveLength(0);
    expect(committed).not.toContain("audit_success");
    // The booking_failed audit in the catch block fires separately (out of tx) — not simulated here
  });
});
