// scripts/lib/rail-crash-handler.cjs — shared crash visibility for the heavy rail/soak jobs.
//
// WHY (2026-07-18 → 07-19 incident, ops-experience OA-005/OR-007): the canonical tree lost 18 of
// 34 declared deps at 21:38. cert-rig and full-lane both `require("dotenv")` INSIDE a catch-less
// `main()` → unhandled rejection → exit 1 with no JSONL, no audit, no Discord. soak-watcher
// required it at MODULE TOP LEVEL → it died before its own `main().catch()` was ever attached.
// Three jobs failed nightly for 36 hours and said nothing. A rail that dies silently is the exact
// disease the rails exist to cure.
//
// CONTRACT: this module must NEVER require a non-builtin — it is the thing that reports a missing
// module — must never throw, and must never let one failing sink suppress the other.
"use strict";

const MAX_STACK = 2_000;

function describeError(error) {
  if (error instanceof Error) return { message: error.message || String(error), code: error.code ?? null, stack: error.stack ?? "" };
  if (error === null || error === undefined) return { message: String(error), code: null, stack: "" };
  return { message: typeof error === "string" ? error : JSON.stringify(error), code: null, stack: "" };
}

// PURE — deterministic in → deterministic out (soak-mold §13 DI pattern; no clock, no I/O).
function buildCrashRow({ rail, error, nowMs }) {
  const d = describeError(error);
  return {
    crashed: true,
    rail,
    error: d.message.slice(0, 500),
    errorCode: d.code,
    stack: String(d.stack).slice(0, MAX_STACK),
    tMs: nowMs,
  };
}

function crashMessage(row) {
  const code = row.errorCode ? ` (${row.errorCode})` : "";
  return `🔴 Tower Rails — ${row.rail} CRASHED${code}: ${row.error.slice(0, 300)}`;
}

// F-1 (Grade A, CRITICAL). This previously did `await fn(arg); return {ok:true}` — it DISCARDED
// the sink's return and reported success for anything that didn't THROW. But the real sink,
// `rail-runtime.postDiscord`, NEVER throws: it returns `{ok:false, reason}` on a missing
// webhook, a non-2xx, or a network error. So `notifyOk` read TRUE in every real Discord
// failure — the crash row lied about whether the alert was delivered, and lied precisely when
// alerting was broken, which is the only time it matters.
//
// The honest-signal disease inside the crash-visibility tool built to cure it. A sink that
// REPORTS failure by return value is now treated exactly like one that throws.
async function callSink(fn, arg) {
  if (typeof fn !== "function") return { ok: false, reason: "sink_unavailable" };
  try {
    const r = await fn(arg);
    if (r && r.ok === false) {
      return { ok: false, reason: String(r.reason || "sink_reported_failure").slice(0, 300) };
    }
    return { ok: true };
  } catch (e) {
    const d = describeError(e);
    return { ok: false, reason: d.message.slice(0, 300) };
  }
}

// Best-effort on BOTH sinks, independently. Never throws. Sets exit 1 so the scheduler still
// records a failure even if every sink is down.
async function handleRailCrash({ rail, error, nowMs, writeLedgerFn, notifyFn, setExitCode = true }) {
  const row = buildCrashRow({ rail, error, nowMs: nowMs ?? Date.now() });

  // Independent, sequential, neither guarded by the other's success.
  const ledger = await callSink(writeLedgerFn, row);
  const notify = await callSink(notifyFn, crashMessage(row));

  try {
    // Last-resort visibility: stderr always exists even when both sinks are gone.
    console.error(JSON.stringify({ ...row, ledgerOk: ledger.ok, notifyOk: notify.ok }));
  } catch { /* ignore — never throw from the crash handler */ }

  if (setExitCode) process.exitCode = 1;
  return { row, ledger, notify };
}

// Convenience wrapper for an entrypoint's `main()`. Usage:
//   main().catch(guardRailMain({ rail: "cert", writeLedgerFn: writeJsonl, notifyFn: postDiscord }));
function guardRailMain({ rail, writeLedgerFn, notifyFn }) {
  return (error) => handleRailCrash({ rail, error, writeLedgerFn, notifyFn });
}

module.exports = { buildCrashRow, crashMessage, handleRailCrash, guardRailMain };
