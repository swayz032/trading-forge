// readHealthResilient retry logic (the 3AM Windows-maintenance false-positive fix). Pure via DI'd probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import S from "../soak-sensors.cjs";

test("resilient probe returns the first reachable result and stops early", async () => {
  let calls = 0;
  const probe = async () => { calls++; return calls < 3 ? { reachable: false, ok: false, errCode: "TimeoutError" } : { reachable: true, ok: true, status: 200 }; };
  const r = await S.readHealthResilient({ healthUrl: "x", attempts: 6, gapMs: 0, probe });
  assert.equal(r.reachable, true);
  assert.equal(r.attempts, 3);
  assert.equal(calls, 3); // did NOT keep probing after success
});

test("all attempts fail -> unreachable, preserves last errCode + attempts count", async () => {
  let calls = 0;
  const probe = async () => { calls++; return { reachable: false, ok: false, errCode: "ECONNREFUSED" }; };
  const r = await S.readHealthResilient({ healthUrl: "x", attempts: 4, gapMs: 0, probe });
  assert.equal(r.reachable, false);
  assert.equal(r.errCode, "ECONNREFUSED");
  assert.equal(r.attempts, 4);
  assert.equal(calls, 4);
});

test("default is a single attempt (regular 30s sample path stays single-shot)", async () => {
  let calls = 0;
  const probe = async () => { calls++; return { reachable: false, ok: false, errCode: "x" }; };
  const r = await S.readHealthResilient({ healthUrl: "x", probe });
  assert.equal(calls, 1);
  assert.equal(r.attempts, 1);
});

test("reachable-but-non-200 (auth-gated/slow) counts as reachable — not a retry target", async () => {
  let calls = 0;
  const probe = async () => { calls++; return { reachable: true, ok: false, status: 503 }; };
  const r = await S.readHealthResilient({ healthUrl: "x", attempts: 6, gapMs: 0, probe });
  assert.equal(r.reachable, true);
  assert.equal(r.attempts, 1);
  assert.equal(calls, 1);
});
