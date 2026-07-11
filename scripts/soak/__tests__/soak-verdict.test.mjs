// Pure verdict-engine tests. Zero framework/config coupling: node:test + node:assert.
// Run: node --test scripts/soak/__tests__/soak-verdict.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import V from "../soak-verdict.cjs";

const GB = 1024 ** 3;

test("linearSlopePerHour: flat series → ~0 slope", () => {
  const s = Array.from({ length: 10 }, (_, i) => ({ tMs: i * 60000, valueMb: 500 }));
  assert.ok(Math.abs(V.linearSlopePerHour(s).slopeMbPerHr) < 1e-6);
});

test("linearSlopePerHour: rising 60MB over 1h → +60 MB/hr", () => {
  const s = Array.from({ length: 61 }, (_, i) => ({ tMs: i * 60000, valueMb: 500 + i }));
  assert.ok(Math.abs(V.linearSlopePerHour(s).slopeMbPerHr - 60) < 0.05);
});

test("linearSlopePerHour: <2 points → 0 slope, Infinity CI", () => {
  assert.deepEqual(V.linearSlopePerHour([{ tMs: 0, valueMb: 1 }]), { slopeMbPerHr: 0, ciHalfWidth: Infinity });
});

test("projectGrowthMb: 5.7 MB/hr over 720h ≈ 4104 MB", () => {
  assert.ok(Math.abs(V.projectGrowthMb(5.7, 720) - 4104) < 0.5);
});

test("gradeMemory: slope below noise floor → GREEN (flat)", () => {
  assert.equal(V.gradeMemory({ slopeMbPerHr: 3, ciHalfWidth: 5, noiseFloorMbPerHr: 4 }), "GREEN");
});
test("gradeMemory: confident fast rise (10 MB/hr → 7GB/30d) → RED", () => {
  assert.equal(V.gradeMemory({ slopeMbPerHr: 10, ciHalfWidth: 1, noiseFloorMbPerHr: 2 }), "RED");
});
test("gradeMemory: confident moderate rise (2.5 MB/hr → ~1.8GB/30d) → AMBER", () => {
  assert.equal(V.gradeMemory({ slopeMbPerHr: 2.5, ciHalfWidth: 0.5, noiseFloorMbPerHr: 1 }), "AMBER");
});

test("gradeDisk: 1GB/6h with 100GB free → ~25 days → AMBER", () => {
  const r = V.gradeDisk({ freeBytesStart: 100 * GB, freeBytesEnd: 99 * GB, windowHours: 6, totalBytes: 500 * GB });
  assert.equal(r.verdict, "AMBER");
  assert.ok(Math.abs(r.daysToFull - 24.75) < 1);
});
test("gradeDisk: 1GB/6h with 40GB free → 10 days → RED", () => {
  assert.equal(V.gradeDisk({ freeBytesStart: 40 * GB, freeBytesEnd: 39 * GB, windowHours: 6, totalBytes: 500 * GB }).verdict, "RED");
});
test("gradeDisk: no measurable loss → GREEN", () => {
  assert.equal(V.gradeDisk({ freeBytesStart: 100 * GB, freeBytesEnd: 100 * GB, windowHours: 6, totalBytes: 500 * GB }).verdict, "GREEN");
});

test("gradeVram: stable floor → GREEN", () => assert.equal(V.gradeVram([400, 402, 399, 401]), "GREEN"));
test("gradeVram: monotonic ratchet up → RED", () => assert.equal(V.gradeVram([400, 900, 1500, 2100]), "RED"));
test("gradeVram: empty/no GPU → UNAVAILABLE", () => assert.equal(V.gradeVram([]), "UNAVAILABLE"));

test("gradeRestarts: stable PID → GREEN", () => assert.equal(V.gradeRestarts([{ pid: 1, startMs: 5 }, { pid: 1, startMs: 5 }]), "GREEN"));
test("gradeRestarts: PID change → RED", () => assert.equal(V.gradeRestarts([{ pid: 1, startMs: 5 }, { pid: 2, startMs: 9 }]), "RED"));

test("gradeHeartbeat: all ok → GREEN", () => assert.equal(V.gradeHeartbeat([{ tMs: 0, ok: true }, { tMs: 60000, ok: true }]), "GREEN"));
test("gradeHeartbeat: >2min continuous gap → RED", () => assert.equal(V.gradeHeartbeat([{ tMs: 0, ok: false }, { tMs: 150000, ok: false }]), "RED"));

const green = { memory: "GREEN", vram: "GREEN", disk: "GREEN", restarts: "GREEN", heartbeat: "GREEN" };
test("computeNightVerdict: night 3 (calibration) → CALIBRATING", () =>
  assert.equal(V.computeNightVerdict({ metricGrades: green, nightIndex: 3, invalidating: false }), "CALIBRATING"));
test("computeNightVerdict: night 20 all green → GREEN", () =>
  assert.equal(V.computeNightVerdict({ metricGrades: green, nightIndex: 20, invalidating: false }), "GREEN"));
test("computeNightVerdict: night 20 one red → RED", () =>
  assert.equal(V.computeNightVerdict({ metricGrades: { ...green, memory: "RED" }, nightIndex: 20, invalidating: false }), "RED"));
test("computeNightVerdict: invalidating beats everything (even calibration) → INVALID", () =>
  assert.equal(V.computeNightVerdict({ metricGrades: green, nightIndex: 3, invalidating: true }), "INVALID"));
