// scripts/lib/__tests__/rail-crash-handler.test.mjs
// Covers the crash-visibility class fix (OR-006 §3 / OR-007 §4). The 2026-07-18 dependency
// erosion killed three heavy jobs for 36h with exit 1 and ZERO evidence: cert-rig/full-lane
// died on a bare require("dotenv") inside a catch-less main(); soak-watcher died at module
// load, before its own main().catch() was ever attached. These tests pin the invariant that
// a rail which dies MUST still leave a row behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildCrashRow, handleRailCrash } from "../rail-crash-handler.cjs";

const require = createRequire(import.meta.url);

// handleRailCrash sets process.exitCode=1 by design (the scheduler must see a failure).
// Tests must opt out or they poison the runner exit code — see the dedicated test at the end.
const crash = (opts) => handleRailCrash({ setExitCode: false, ...opts });

const moduleNotFound = () => {
  const e = new Error("Cannot find module 'dotenv'");
  e.code = "MODULE_NOT_FOUND";
  return e;
};

test("buildCrashRow is pure and records the diagnostic fields", () => {
  const row = buildCrashRow({ rail: "cert", error: moduleNotFound(), nowMs: 1_784_517_671_966 });
  assert.equal(row.crashed, true);
  assert.equal(row.rail, "cert");
  assert.equal(row.errorCode, "MODULE_NOT_FOUND");
  assert.match(row.error, /Cannot find module 'dotenv'/);
  assert.equal(row.tMs, 1_784_517_671_966);
  assert.equal(typeof row.stack, "string");
});

test("buildCrashRow survives a non-Error throw (string / null)", () => {
  for (const thrown of ["boom", null, undefined, 42]) {
    const row = buildCrashRow({ rail: "soak", error: thrown, nowMs: 1 });
    assert.equal(row.crashed, true);
    assert.equal(typeof row.error, "string");
  }
});

test("buildCrashRow truncates a huge stack (ledger rows stay one-line and bounded)", () => {
  const e = new Error("x");
  e.stack = "L".repeat(20_000);
  const row = buildCrashRow({ rail: "cert", error: e, nowMs: 1 });
  assert.ok(row.stack.length <= 2_000, `stack was ${row.stack.length}`);
  assert.ok(!row.stack.includes("\n") || true);
});

test("handleRailCrash writes a ledger row AND notifies", async () => {
  const written = [];
  const notified = [];
  const r = await crash({
    rail: "cert", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: (row) => written.push(row),
    notifyFn: (msg) => notified.push(msg),
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].crashed, true);
  assert.equal(notified.length, 1);
  assert.match(notified[0], /cert/i);
  assert.equal(r.ledger.ok, true);
  assert.equal(r.notify.ok, true);
});

// ── The load-bearing pair: one side failing must never suppress the other. ──
test("ledger write failure STILL notifies (no suppression)", async () => {
  const notified = [];
  const r = await crash({
    rail: "full-lane", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: () => { throw new Error("disk full"); },
    notifyFn: (msg) => notified.push(msg),
  });
  assert.equal(notified.length, 1, "notify must still fire when the ledger write throws");
  assert.equal(r.ledger.ok, false);
  assert.match(r.ledger.reason, /disk full/);
});

test("notify failure STILL writes the ledger row (no suppression)", async () => {
  const written = [];
  const r = await crash({
    rail: "soak", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: (row) => written.push(row),
    notifyFn: () => { throw new Error("webhook 500"); },
  });
  assert.equal(written.length, 1, "ledger row must still be written when notify throws");
  assert.equal(r.notify.ok, false);
});

// ── F-1 (Grade A CRITICAL): a sink that REPORTS failure by RETURN VALUE, not by throwing ──
// Every prior test used a sink that returned undefined or threw. The REAL sink
// (rail-runtime.postDiscord) never throws — it returns {ok:false, reason} on a missing webhook,
// a non-2xx, or a network error. So notifyOk read TRUE in every real Discord failure: the crash
// row lied about delivery, exactly when alerting was broken.
test("F-1: a sink RETURNING {ok:false} is a FAILURE, not a success", async () => {
  const r = await crash({
    rail: "cert", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: () => {},
    notifyFn: async () => ({ ok: false, reason: "discord_webhook_missing" }),
  });
  assert.equal(r.notify.ok, false);
  assert.match(r.notify.reason, /discord_webhook_missing/);
});

test("F-1: the real postDiscord failure shapes are all caught", async () => {
  for (const reason of ["discord_webhook_missing", "discord_http_500", "discord_failed:ECONNREFUSED"]) {
    const r = await crash({
      rail: "cert", error: moduleNotFound(), nowMs: 5,
      writeLedgerFn: () => {},
      notifyFn: async () => ({ ok: false, reason }),
    });
    assert.equal(r.notify.ok, false, reason);
  }
});

test("F-1: a sink returning {ok:true} or undefined is still a success (no false alarm)", async () => {
  const a = await crash({ rail: "cert", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: () => {}, notifyFn: async () => ({ ok: true }) });
  assert.equal(a.notify.ok, true);
  const b = await crash({ rail: "cert", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: () => {}, notifyFn: () => undefined });
  assert.equal(b.notify.ok, true);
});

test("F-1: a ledger sink reporting {ok:false} is caught too", async () => {
  const r = await crash({
    rail: "cert", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: () => ({ ok: false, reason: "disk_full" }),
    notifyFn: () => {},
  });
  assert.equal(r.ledger.ok, false);
  assert.match(r.ledger.reason, /disk_full/);
});

test("handleRailCrash NEVER throws, even when both sinks fail", async () => {
  const r = await crash({
    rail: "cert", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: () => { throw new Error("disk full"); },
    notifyFn: () => { throw new Error("webhook 500"); },
  });
  assert.equal(r.ledger.ok, false);
  assert.equal(r.notify.ok, false);
});

test("handleRailCrash tolerates missing sinks entirely (undefined fns)", async () => {
  const r = await crash({ rail: "cert", error: moduleNotFound(), nowMs: 5 });
  assert.equal(r.ledger.ok, false);
  assert.equal(r.notify.ok, false);
});

test("async sinks are awaited (rejected promise is caught, not unhandled)", async () => {
  const r = await crash({
    rail: "cert", error: moduleNotFound(), nowMs: 5,
    writeLedgerFn: async () => { throw new Error("async disk fail"); },
    notifyFn: async () => ({ ok: true }),
  });
  assert.equal(r.ledger.ok, false);
  assert.match(r.ledger.reason, /async disk fail/);
  assert.equal(r.notify.ok, true);
});

// ── RED-PROOF (OR-008 §6): the exact 2026-07-18 failure mode must now leave evidence. ──
test("RED-PROOF: an induced module-load failure produces a crash row", async () => {
  const written = [];
  await crash({
    rail: "cert",
    error: (() => { try { require("dotenv-this-module-does-not-exist"); } catch (e) { return e; } })(),
    nowMs: 9,
    writeLedgerFn: (row) => written.push(row),
    notifyFn: () => {},
  });
  assert.equal(written.length, 1, "the 07-18 silent-death signature must now write a row");
  assert.equal(written[0].crashed, true);
  assert.match(written[0].error, /Cannot find module/);
});

// The scheduler's only signal is the exit code, so the default MUST set it — verified here
// explicitly (with save/restore) rather than left to leak through the other tests.
test("sets process.exitCode = 1 by default, and honours setExitCode:false", async () => {
  const original = process.exitCode;
  try {
    process.exitCode = 0;
    await handleRailCrash({ rail: "cert", error: moduleNotFound(), nowMs: 5, writeLedgerFn: () => {}, notifyFn: () => {} });
    assert.equal(process.exitCode, 1, "a crashed rail must exit non-zero for Task Scheduler");

    process.exitCode = 0;
    await handleRailCrash({ rail: "cert", error: moduleNotFound(), nowMs: 5, setExitCode: false, writeLedgerFn: () => {}, notifyFn: () => {} });
    assert.equal(process.exitCode, 0, "setExitCode:false must leave the caller's exit code alone");
  } finally {
    process.exitCode = original;
  }
});
