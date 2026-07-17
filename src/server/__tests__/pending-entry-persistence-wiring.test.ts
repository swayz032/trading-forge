/**
 * pending-entry-persistence-wiring.test.ts — M2 determinism + durability (2026-07-17), Item 1
 *
 * Source-analysis structural tests (same pattern as
 * pending-entry-queue-fill-gate-recheck.test.ts) proving the REAL production
 * call sites are wired correctly — the pending-entry-durability.integration
 * test proves the persistence-layer FUNCTIONS work in isolation; this test
 * proves paper-signal-service.ts and scheduler.ts actually CALL them at the
 * right points, in the right order, relative to the in-memory Map operations
 * they mirror.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIGNAL_SRC = readFileSync(resolve(__dirname, "../services/paper-signal-service.ts"), "utf8");
const SCHEDULER_SRC = readFileSync(resolve(__dirname, "../scheduler.ts"), "utf8");

describe("paper-signal-service.ts — pending-entry persistence wiring", () => {
  it("imports the persistence backstop functions from pending-entry-persistence.ts", () => {
    expect(SIGNAL_SRC).toContain('from "../lib/pending-entry-persistence.js"');
    expect(SIGNAL_SRC).toContain("persistPendingEntry");
    expect(SIGNAL_SRC).toContain("deletePendingEntryRow");
    expect(SIGNAL_SRC).toContain("deleteAllPendingEntriesForSession");
    expect(SIGNAL_SRC).toContain("rehydratePendingEntriesForSession");
  });

  it("enqueue: persistPendingEntry is called immediately after pendingEntryQueue.set()", () => {
    const setIdx = SIGNAL_SRC.indexOf("pendingEntryQueue.set(pendingKey, newPendingEntry);");
    expect(setIdx).toBeGreaterThan(-1);
    const afterSet = SIGNAL_SRC.slice(setIdx, setIdx + 400);
    expect(afterSet).toContain("void persistPendingEntry(newPendingEntry);");
  });

  it("consume (fill or drop): deletePendingEntryRow is called immediately after pendingEntryQueue.delete()", () => {
    const deleteIdx = SIGNAL_SRC.indexOf('pendingEntryQueue.delete(pendingKey); // consume the pending entry');
    expect(deleteIdx).toBeGreaterThan(-1);
    const afterDelete = SIGNAL_SRC.slice(deleteIdx, deleteIdx + 500);
    expect(afterDelete).toContain("void deletePendingEntryRow(sessionId, symbol);");
  });

  it("session-stop cleanup: deleteAllPendingEntriesForSession is called inside cleanupSession()", () => {
    const fnIdx = SIGNAL_SRC.indexOf("export function cleanupSession(sessionId: string, symbols: string[]): void {");
    expect(fnIdx).toBeGreaterThan(-1);
    const fnEndIdx = SIGNAL_SRC.indexOf("\n}\n", fnIdx);
    const fnBody = SIGNAL_SRC.slice(fnIdx, fnEndIdx);
    expect(fnBody).toContain("void deleteAllPendingEntriesForSession(sessionId);");
  });

  it("exports rehydratePendingEntryQueueForSession for scheduler.ts boot re-hydration", () => {
    expect(SIGNAL_SRC).toContain("export async function rehydratePendingEntryQueueForSession(");
    expect(SIGNAL_SRC).toContain("pendingEntryQueue.set(`${entry.sessionId}:${entry.symbol}`, entry as PendingEntry);");
  });
});

describe("scheduler.ts — boot re-hydration wiring (resumeActivePaperSessions)", () => {
  it("imports rehydratePendingEntryQueueForSession from paper-signal-service.js", () => {
    expect(SCHEDULER_SRC).toContain("rehydratePendingEntryQueueForSession");
    expect(SCHEDULER_SRC).toMatch(/from ".\/services\/paper-signal-service\.js"/);
  });

  it("calls rehydratePendingEntryQueueForSession INSIDE resumeActivePaperSessions, AFTER the B5 PAPER+ skip guard (never for PAPER+ sessions)", () => {
    const fnIdx = SCHEDULER_SRC.indexOf("async function resumeActivePaperSessions(): Promise<void> {");
    expect(fnIdx).toBeGreaterThan(-1);
    const fnEndIdx = SCHEDULER_SRC.indexOf("\n}\n", fnIdx + 200); // skip past nested closing braces of inner blocks by searching after some offset — refined below
    // Find the actual end of THIS function by matching against the next top-level function/const declaration.
    const nextDeclIdx = SCHEDULER_SRC.indexOf("\n/**", fnIdx + 500);
    const fnBody = SCHEDULER_SRC.slice(fnIdx, nextDeclIdx > -1 ? nextDeclIdx : fnEndIdx);

    const b5SkipIdx = fnBody.indexOf("B5: PAPER-ENGINE AUTHORITY GUARD");
    const rehydrateCallIdx = fnBody.indexOf("await rehydratePendingEntryQueueForSession(session.id)");
    expect(b5SkipIdx).toBeGreaterThan(-1);
    expect(rehydrateCallIdx).toBeGreaterThan(-1);
    expect(rehydrateCallIdx).toBeGreaterThan(b5SkipIdx);
  });

  it("re-hydration failure is caught and logged — never throws out of resumeActivePaperSessions (fail-soft, no worse than pre-M2 drop)", () => {
    const callIdx = SCHEDULER_SRC.indexOf("await rehydratePendingEntryQueueForSession(session.id)");
    const surrounding = SCHEDULER_SRC.slice(Math.max(0, callIdx - 100), callIdx + 500);
    expect(surrounding).toContain("try {");
    expect(surrounding).toContain("catch (err)");
  });
});
