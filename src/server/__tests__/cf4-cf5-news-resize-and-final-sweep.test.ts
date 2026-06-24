/**
 * cf4-cf5-news-resize-and-final-sweep.test.ts
 *
 * CF4 — H3 Topstep reduce_size news action re-applied at pending-entry fill.
 *   H3 (commit 456b716) added a 6-gate re-check at pending-entry fill.
 *   CF4 closes the gap where reduce_size at fill time was noted but NOT applied —
 *   the queued contracts count was used unchanged even when the fill lands inside
 *   a T1 news window that returned reduce_size.
 *
 * CF5 — F1 final sweep: 6 deferred files added to lint scope.
 *   Verifies every notifyCritical/notifyWarning call in the 6 owned files is
 *   wrapped with appendFamilyGradePostscript (regression guard going forward).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

// ─── Source file loader ───────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(__dirname, "..");

function readSrc(relPath: string): string {
  const full = resolve(SERVER_DIR, relPath);
  if (!existsSync(full)) throw new Error(`Source file not found: ${full}`);
  return readFileSync(full, "utf8");
}

const PSS = readSrc("services/paper-signal-service.ts");

// ─── CF4: News reduce_size applied at fill time ───────────────────────────────

describe("CF4 — pending-entry fill: Topstep reduce_size contracts applied at fill time", () => {
  // Isolate the H3 gate-re-check block for source analysis
  const h3Start = PSS.indexOf("H3 (2026-06-23): Re-evaluate all entry gates at fill time");
  const h3End   = PSS.indexOf("End H3 pending-entry fill-gate re-check");

  it("H3 block is present in paper-signal-service.ts", () => {
    expect(h3Start).toBeGreaterThan(-1);
    expect(h3End).toBeGreaterThan(h3Start);
  });

  it("CF4 comment is present inside H3 block", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain("CF4 (2026-06-24): When action === \"reduce_size\"");
  });

  it("reduce_size: resolveNewsAction result destructured with sizeFactor (not just action)", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    // Verify that sizeFactor is captured from resolveNewsAction in the Gate 4 block
    expect(h3Block).toContain("const { action: newsAction, sizeFactor } = resolveNewsAction(");
  });

  it("reduce_size: Math.floor applied to original contracts × sizeFactor", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain("const reducedContracts = Math.floor(originalContracts * sizeFactor)");
  });

  it("reduce_size: originalContracts captured from pendingEntry.contracts before modification", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain("const originalContracts = pendingEntry.contracts");
  });

  it("reduce_size: pendingEntry.contracts mutated to reducedContracts on allow-through path", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain("pendingEntry.contracts = reducedContracts");
  });

  it("drops entry with pending_entry.dropped_news_size_reduced_to_zero when reducedContracts <= 0", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain('pendingDropReason = "news_size_reduced_to_zero"');
  });

  it("news_size_reduced_to_zero is classified as info severity (correct behavior, not a warning)", () => {
    // The dropSeverity block should include news_size_reduced_to_zero in the info group
    const dropSeverityIdx = PSS.indexOf("const dropSeverity: \"info\" | \"warning\"");
    expect(dropSeverityIdx).toBeGreaterThan(-1);
    // Look forward 10 lines from dropSeverity assignment for the info list
    const dropSeveritySnippet = PSS.slice(dropSeverityIdx, dropSeverityIdx + 600);
    expect(dropSeveritySnippet).toContain('"news_size_reduced_to_zero"');
  });

  it("emits pending_entry.contracts_reduced_news_window audit with original + reduced counts on allow-through", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain('action: "pending_entry.contracts_reduced_news_window"');
    expect(h3Block).toContain("originalContracts");
    expect(h3Block).toContain("reducedContracts");
  });

  it("span attributes set for news reduce: news_reduce_size_factor_at_fill + counts", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain('span.setAttribute("news_reduce_size_factor_at_fill", sizeFactor)');
    expect(h3Block).toContain('span.setAttribute("news_reduced_contracts_original", originalContracts)');
    expect(h3Block).toContain('span.setAttribute("news_reduced_contracts_fill", reducedContracts)');
  });

  it("block action still drops entry on newsAction === block (existing behavior preserved)", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain('if (newsAction === "block")');
    expect(h3Block).toContain('pendingDropReason = "macro_blackout"');
  });

  it("non-T1-window fills proceed with original contract count (allow action path)", () => {
    // Verify the fail-open pattern: no modification when action === "allow"
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain("// action === \"allow\": fill proceeds unchanged — no modification.");
  });

  it("news gate falls back to Fail-OPEN on calendar/news service hiccup", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    expect(h3Block).toContain("Fail-OPEN: calendar/news failure is non-blocking");
  });

  it("Gate 4 uses FILL timestamp (bar.timestamp) not signal timestamp", () => {
    const h3Block = PSS.slice(h3Start, h3End);
    // getT1ReleaseWindow should receive bar.timestamp (the fill bar) not pendingEntry.signalBarTimestamp
    expect(h3Block).toContain("getT1ReleaseWindow(symbol, bar.timestamp)");
  });
});

// ─── CF5: Family-grade postscript sweep — paper-signal-service.ts ────────────

describe("CF5 — paper-signal-service.ts: no bare notifyCritical/notifyWarning calls", () => {
  it("imports appendFamilyGradePostscript", () => {
    expect(PSS).toContain('import { appendFamilyGradePostscript } from "../lib/notification-helpers.js"');
  });

  it("Path C evaluation failed notifyCritical is wrapped with appendFamilyGradePostscript", () => {
    // Find the Path C error notifyCritical and verify it has the postscript wrapper
    const pathCIdx = PSS.indexOf("Path C evaluation failed");
    expect(pathCIdx).toBeGreaterThan(-1);
    // Look forward 15 lines from the call for the wrapper
    const snippet = PSS.slice(pathCIdx, pathCIdx + 600);
    expect(snippet).toContain("appendFamilyGradePostscript(");
  });
});

// ─── CF5: Family-grade postscript sweep — pattern-aggregator-service.ts ──────

describe("CF5 — pattern-aggregator-service.ts: no bare notifyCritical/notifyWarning calls", () => {
  const PAS = readSrc("services/pattern-aggregator-service.ts");

  it("_warnConsecFailures notifyWarning is wrapped with appendFamilyGradePostscript", () => {
    const fnIdx = PAS.indexOf("function _warnConsecFailures");
    expect(fnIdx).toBeGreaterThan(-1);
    const fnSnippet = PAS.slice(fnIdx, fnIdx + 800);
    expect(fnSnippet).toContain("appendFamilyGradePostscript(");
  });

  it("_notifyLearningLoopReady notifyWarning is wrapped with appendFamilyGradePostscript", () => {
    // The 'Learning Loop READY but OFF' call already had fullBody wrapping — regression guard
    const idx = PAS.indexOf("Learning Loop READY but OFF");
    expect(idx).toBeGreaterThan(-1);
    const snippet = PAS.slice(Math.max(0, idx - 400), idx + 200);
    expect(snippet).toContain("appendFamilyGradePostscript(");
  });
});

// ─── CF5: Family-grade postscript sweep — scheduler.ts ────────────────────────

describe("CF5 — scheduler.ts: no bare notifyCritical/notifyWarning calls", () => {
  const SCHED = readSrc("scheduler.ts");

  it("Pine Artifact Auto-Recompiled notifyWarning is wrapped with appendFamilyGradePostscript", () => {
    const idx = SCHED.indexOf("Pine Artifact Auto-Recompiled:");
    expect(idx).toBeGreaterThan(-1);
    // Look 20 lines forward from the title to find the wrapper
    const snippet = SCHED.slice(idx, idx + 600);
    expect(snippet).toContain("appendFamilyGradePostscript(");
  });
});

// ─── CF5: Family-grade postscript sweep — paper-journal-recon.ts ─────────────

describe("CF5 — paper-journal-recon.ts: no bare notifyCritical/notifyWarning calls", () => {
  const PJR = readSrc("production/paper-journal-recon.ts");

  it("shadow-signal delta notifyWarning is wrapped (const body = appendFamilyGradePostscript pattern)", () => {
    const idx = PJR.indexOf("Shadow-signal intercept delta");
    expect(idx).toBeGreaterThan(-1);
    const lookback = PJR.slice(Math.max(0, idx - 600), idx);
    const lookahead = PJR.slice(idx, idx + 200);
    expect(lookback.includes("appendFamilyGradePostscript(") || lookahead.includes("appendFamilyGradePostscript(")).toBe(true);
  });

  it("journal drift notifyCritical is wrapped (const body = appendFamilyGradePostscript pattern)", () => {
    const idx = PJR.indexOf("Paper journal reconciliation DRIFT");
    expect(idx).toBeGreaterThan(-1);
    // body = appendFamilyGradePostscript is built then notifyCritical(... body ...)
    const lookback = PJR.slice(Math.max(0, idx - 200), idx + 500);
    expect(lookback).toContain("appendFamilyGradePostscript(");
  });
});

// ─── CF5: Family-grade postscript sweep — quantum-replay-weekly-service.ts ───

describe("CF5 — quantum-replay-weekly-service.ts: no bare notifyCritical/notifyWarning calls", () => {
  const QRS = readSrc("services/quantum-replay-weekly-service.ts");

  it("timeout notifyWarning is wrapped (const fullBody = appendFamilyGradePostscript pattern)", () => {
    // The TIMED OUT notifyWarning uses a pre-built `fullBody` variable.
    // Find the notifyWarning and look 800 chars back to catch the fullBody builder.
    const idx = QRS.indexOf("[WEEKLY] Quantum Replay Analysis TIMED OUT");
    expect(idx).toBeGreaterThan(-1);
    const lookback = QRS.slice(Math.max(0, idx - 800), idx);
    expect(lookback).toContain("appendFamilyGradePostscript(");
  });

  it("failure notifyWarning is wrapped (const fullBody = appendFamilyGradePostscript pattern)", () => {
    // The FAILED notifyWarning uses a pre-built `fullBody` variable.
    // "[WEEKLY] Quantum Replay Analysis FAILED" appears in BOTH the operatorBody template literal
    // (first occurrence) AND the notifyWarning title (last/second occurrence).
    // Use lastIndexOf to find the notifyWarning title (last occurrence) so lookback reaches fullBody.
    const idx = QRS.lastIndexOf("[WEEKLY] Quantum Replay Analysis FAILED");
    expect(idx).toBeGreaterThan(-1);
    const lookback = QRS.slice(Math.max(0, idx - 800), idx);
    expect(lookback).toContain("appendFamilyGradePostscript(");
  });
});

// ─── CF5: Family-grade postscript sweep — remote-power-cycle-service.ts ──────

describe("CF5 — remote-power-cycle-service.ts: no bare notifyCritical/notifyWarning calls", () => {
  const RPCS = readSrc("services/remote-power-cycle-service.ts");

  it("power-cycle notifyCritical uses inline appendFamilyGradePostscript", () => {
    // The notifyCritical call uses the inline pattern:
    //   notifyCritical(title, appendFamilyGradePostscript(operatorBody, familyBody, familyAction), meta)
    // The title contains "Heartbeat: remote power-cycle". Find any notifyCritical call near it.
    // Search for the appendFamilyGradePostscript wrapper directly in the function-scope context.
    const idx = RPCS.indexOf("Heartbeat: remote power-cycle");
    expect(idx).toBeGreaterThan(-1);
    // Look forward 500 chars from the title to find the inline appendFamilyGradePostscript wrapper
    const snippet = RPCS.slice(idx, idx + 500);
    expect(snippet).toContain("appendFamilyGradePostscript(");
  });
});

// ─── CF5: Lint script exits 0 (scope now 48 files) ────────────────────────────

describe("CF5 — check-family-grade-postscript lint script", () => {
  it("check:family-grade-postscript exits 0 against the post-CF5 codebase", () => {
    // Run the lint script and verify it exits 0 with no offenders.
    // If this fails, a newly-added notifyCritical/notifyWarning is missing its postscript wrap.
    let output = "";
    let exitCode = 0;
    try {
      output = execSync(
        "npx tsx scripts/check-family-grade-postscript.ts",
        {
          cwd: resolve(__dirname, "../../.."),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = e.status ?? 1;
      output = (e.stdout ?? "") + (e.stderr ?? "");
    }
    if (exitCode !== 0) {
      console.error("check-family-grade-postscript FAILED:\n", output);
    }
    expect(exitCode, `check-family-grade-postscript exited ${exitCode}: ${output}`).toBe(0);
  });

  it("lint scope is at least 48 files (5 CF5 files added beyond M11+F1 baseline)", () => {
    // Source analysis: count OWNED_FILES_RELATIVE entries
    const lintSrc = readFileSync(
      resolve(__dirname, "../../../scripts/check-family-grade-postscript.ts"),
      "utf8",
    );
    const ownedFilesMatch = lintSrc.match(/const OWNED_FILES_RELATIVE[^=]*=\s*\[([^\]]*)\]/s);
    expect(ownedFilesMatch).not.toBeNull();
    const fileEntries = (ownedFilesMatch![1].match(/"[^"]+"/g) ?? []);
    expect(fileEntries.length).toBeGreaterThanOrEqual(48);
  });
});
