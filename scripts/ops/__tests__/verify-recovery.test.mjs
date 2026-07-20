// scripts/ops/__tests__/verify-recovery.test.mjs
//
// Locks the cold-recovery tier verifier. The properties that matter are not "does it pass
// on this box" — it does, because this box is healthy — but:
//   * UNKNOWN never collapses into FAIL (a checker that cannot run must not condemn the box)
//   * FAIL dominates UNKNOWN dominates PASS in the aggregate
//   * the leg-5 probe is ACTUALLY WIRED (it had zero callers before this)
//   * evidence levels are per-leg and NOT uniform — a blanket "drilled" is the false-green
//     this whole runsheet exists to avoid
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PASS, UNKNOWN, FAIL, V, EVIDENCE, CHECKS, tierWsl, tierTasks } from "../verify-recovery.cjs";

const RUNSHEET = path.resolve(process.cwd(), "docs/cold-recovery-runsheet.md");

test("verdict codes: FAIL dominates UNKNOWN dominates PASS, and none collide", () => {
  assert.equal(PASS, 0); assert.equal(UNKNOWN, 2); assert.equal(FAIL, 3);
  assert.notEqual(UNKNOWN, FAIL, "collapsing UNKNOWN into FAIL condemns a box we merely could not measure");
  // 1 is deliberately unused — it is a crashed-checker code, as in the leg-5 probe.
  assert.ok(![PASS, UNKNOWN, FAIL].includes(1), "1 must stay reserved for a crash");
});

test("★ the leg-5 probe is actually WIRED — it had ZERO callers before this", () => {
  const s3 = CHECKS.find((c) => c.leg === "s3");
  assert.ok(s3, "the s3 capability leg must be in the check list");
  const src = fs.readFileSync(path.resolve(process.cwd(), "scripts/ops/verify-recovery.cjs"), "utf8");
  assert.match(src, /verify-s3-capability\.cjs/, "the verifier must invoke the probe driver");
  // A capability check nobody invokes is a capability nobody has.
  assert.ok(fs.existsSync(path.resolve(process.cwd(), "scripts/ops/verify-s3-capability.cjs")));
});

test("★ evidence levels are PER-LEG and not uniform", () => {
  const levels = new Set(Object.values(EVIDENCE));
  assert.ok(levels.size >= 3, `expected mixed evidence levels, got ${[...levels].join(" | ")}`);
  assert.match(EVIDENCE.db, /drilled/i, "the DB leg is the one that was actually drilled");
  for (const leg of ["services", "tasks", "wsl"]) {
    assert.match(EVIDENCE[leg], /not drilled/i, `${leg} must not claim a drill it never had`);
  }
  // The whole point: no leg may silently inherit the DB leg's receipt.
  assert.notEqual(EVIDENCE.services, EVIDENCE.db);
});

test("every check declares a leg, a label and an evidence level", () => {
  for (const c of CHECKS) {
    assert.ok(c.leg && c.label && typeof c.run === "function", `malformed check: ${JSON.stringify(c)}`);
    assert.ok(EVIDENCE[c.leg], `check "${c.leg}" has no evidence level — it would print an undefined claim`);
  }
});

test("★ non-Windows tiers return UNKNOWN, never FAIL", () => {
  // On a POSIX host schtasks/wsl do not exist. Reporting FAIL there would mean "this box is
  // broken" when the truth is "this checker does not apply" — the inverse of the disease.
  if (process.platform === "win32") {
    // On Windows the real calls run; just assert the shape is a legal verdict.
    for (const r of [tierWsl(), tierTasks()]) {
      assert.ok([V.PASS, V.FAIL, V.UNKNOWN].includes(r.verdict), `illegal verdict ${r.verdict}`);
      assert.ok(r.reason, "every verdict must carry a reason code");
    }
  } else {
    assert.equal(tierWsl().verdict, V.UNKNOWN);
    assert.equal(tierTasks().verdict, V.UNKNOWN);
  }
});

// ── The runsheet document itself carries claims, so its claims are asserted ──
test("★ the runsheet NEVER claims a blanket 'drilled'", () => {
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  assert.match(doc, /NOT.{0,3}\s*"?drilled"?/i, "the evidence header must disclaim a blanket drill");
  for (const tier of ["Services", "Scheduled tasks", "WSL runner"]) {
    const row = doc.split("\n").find((l) => l.includes(tier) && l.includes("|"));
    assert.ok(row, `no evidence row for ${tier}`);
    assert.match(row, /NOT DRILLED/i, `${tier} claims evidence it does not have`);
  }
});

test("★ the runsheet carries the KEY FINDINGs — the payload a drill produces", () => {
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  assert.match(doc, /PostgreSQL 17\.10/, "the drilled DB leg's finding (pg17 vs v16) must be recorded");
  assert.match(doc, /footer/i, "leg 5's finding (footer-only read passes on a corrupt object)");
  assert.match(doc, /WSL distro/i, "Tier C's finding (the unlisted prerequisite)");
});

test("★ the real-incident path is SEPARATE and guarded, never adjacent to a rehearsal step", () => {
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  assert.match(doc, /Do not run anything in this section as part of a rehearsal/i);
  assert.match(doc, /operator-only/i);
  // and it must point elsewhere rather than inline the destructive commands
  assert.match(doc, /disaster-recovery-db\.md/);
});

test("the runsheet tells the reader to RUN the verifier, not to read the checklist", () => {
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  assert.match(doc, /verify-recovery\.cjs/, "the runsheet must name its executable check");
  assert.match(doc, /Exit `0`|exit `?0`?/i, "and state what its exit codes mean");
});
