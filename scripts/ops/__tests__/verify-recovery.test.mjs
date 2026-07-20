// scripts/ops/__tests__/verify-recovery.test.mjs
//
// ★★ THE FIRST VERSION OF THIS FILE EXERCISED NO VERDICT LOGIC AT ALL.
// It never called main(), legS3 or tierServices. 10 of 12 independent mutants survived —
// including "map probe FAIL to PASS", "return PASS when no distro exists", and "return PASS
// despite FAILs" — while the commit claimed "a test row cannot drift without going red".
// My own three RED-proofs all sat inside the two areas the tests already covered: I proved
// the guard against the shapes it already caught. Same failure as the leg-5 credential guard,
// one unit later.
//
// So every check is now driven with INJECTED I/O, and the mutants that survived are the
// tests. If a verdict can be flipped, one of these goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PASS, UNKNOWN, FAIL, V, EVIDENCE, CHECKS, REGISTER_SCRIPTS,
  expectedTaskNames, tierServices, tierTasks, tierWsl, legS3, aggregate, runChecks,
} from "../verify-recovery.cjs";

const RUNSHEET = path.resolve(process.cwd(), "docs/cold-recovery-runsheet.md");

/** A fake spawnSync returning a canned result. */
const spawnOk = (stdout, status = 0) => () => ({ status, stdout, stderr: "", error: null });
const spawnErr = (code) => () => ({ status: null, stdout: "", stderr: "", error: Object.assign(new Error("x"), { code }) });

// ── Verdict codes ────────────────────────────────────────────────────────────
test("FAIL dominates UNKNOWN dominates PASS, and 1 stays reserved for a crash", () => {
  assert.equal(PASS, 0); assert.equal(UNKNOWN, 2); assert.equal(FAIL, 3);
  assert.ok(![PASS, UNKNOWN, FAIL].includes(1), "1 must stay reserved for a crashed checker");
});

// ── ★ aggregate() — mutant M5 ("return PASS despite FAILs") lived here ───────
test("★ aggregate: any FAIL -> FAIL, even amid passes", () => {
  assert.equal(aggregate([{ verdict: V.PASS }, { verdict: V.FAIL }, { verdict: V.PASS }]), FAIL);
});
test("★ aggregate: any UNKNOWN (no FAIL) -> UNKNOWN — never silently PASS", () => {
  assert.equal(aggregate([{ verdict: V.PASS }, { verdict: V.UNKNOWN }]), UNKNOWN);
});
test("★ aggregate: FAIL outranks UNKNOWN", () => {
  assert.equal(aggregate([{ verdict: V.UNKNOWN }, { verdict: V.FAIL }]), FAIL);
});
test("aggregate: all PASS -> PASS", () => {
  assert.equal(aggregate([{ verdict: V.PASS }, { verdict: V.PASS }]), PASS);
});

// ── ★ legS3 — mutants M1 (never spawn) and M2 (map FAIL->PASS) lived here ────
test("★ legS3: the probe's exit code maps EXACTLY, including FAIL->FAIL", () => {
  const cases = [[0, V.PASS], [3, V.FAIL], [2, V.UNKNOWN], [1, V.UNKNOWN], [7, V.UNKNOWN]];
  for (const [code, want] of cases) {
    assert.equal(legS3({ spawnFn: spawnOk("", code) }).verdict, want, `probe exit ${code}`);
  }
});
test("★ legS3 ACTUALLY SPAWNS the probe — a wiring claim must be exercised, not grepped", () => {
  // The old test grepped the source for the driver filename. A mutant that kept the string
  // and never spawned survived it. This asserts the call happened, with the right target.
  let called = null;
  legS3({ spawnFn: (exe, args) => { called = { exe, args }; return { status: 0, stdout: "", error: null }; } });
  assert.ok(called, "legS3 did not spawn anything");
  assert.match(called.args[0], /verify-s3-capability\.cjs$/, "spawned the wrong target");
  // Grader mutant M11: repointing the driver to a NONEXISTENT path keeps the basename and
  // passes a name-only check, so the probe silently never runs. The target must exist.
  assert.ok(fs.existsSync(called.args[0]), `driver does not exist: ${called.args[0]}`);
});
test("legS3: an unlaunchable probe is UNKNOWN, never FAIL", () => {
  assert.equal(legS3({ spawnFn: spawnErr("ENOENT") }).verdict, V.UNKNOWN);
});

// ── ★ tierTasks — mutant M4 ("PASS when tasks absent") lived here ────────────
const csv = (rows) => ["\"TaskName\",\"Next Run Time\",\"Status\"", ...rows].join("\r\n");

test("★ tierTasks: a MISSING task is FAIL and is named", () => {
  const r = tierTasks({
    platform: "win32", expected: ["TF-A", "TF-B"],
    spawnFn: spawnOk(csv([`"\\TF-A","N/A","Ready"`])),
  });
  assert.equal(r.verdict, V.FAIL);
  assert.match(r.detail, /TF-B:absent/);
});
test("★ tierTasks: a REGISTERED-BUT-DISABLED task is FAIL — registration is not execution", () => {
  const r = tierTasks({
    platform: "win32", expected: ["TF-A"],
    spawnFn: spawnOk(csv([`"\\TF-A","N/A","Disabled"`])),
  });
  assert.equal(r.verdict, V.FAIL);
  assert.match(r.detail, /TF-A:disabled/);
});
test("★ tierTasks: a SUBSTRING match must not count — field parsing, not includes()", () => {
  // `String.includes` PASSed when an unrelated task merely contained the name.
  const r = tierTasks({
    platform: "win32", expected: ["TF-A"],
    spawnFn: spawnOk(csv([`"\\SomethingTF-AElse","N/A","Ready"`])),
  });
  assert.equal(r.verdict, V.FAIL, "a substring was accepted as the task");
});
test("tierTasks: all present + Ready -> PASS", () => {
  const r = tierTasks({
    platform: "win32", expected: ["TF-A", "TF-B"],
    spawnFn: spawnOk(csv([`"\\TF-A","N/A","Ready"`, `"\\TF-B","N/A","Ready"`])),
  });
  assert.equal(r.verdict, V.PASS);
});
test("★ tierTasks: an EMPTY derived list is UNKNOWN — 'found nothing' is not 'nothing missing'", () => {
  const r = tierTasks({ platform: "win32", expected: [], spawnFn: spawnOk(csv([])) });
  assert.equal(r.verdict, V.UNKNOWN);
  assert.equal(r.reason, "no_expected_derived");
});
test("tierTasks: schtasks failure is UNKNOWN, not FAIL", () => {
  assert.equal(tierTasks({ platform: "win32", expected: ["TF-A"], spawnFn: spawnOk("", 1) }).verdict, V.UNKNOWN);
});
test("tierTasks: non-Windows is UNKNOWN", () => {
  assert.equal(tierTasks({ platform: "linux" }).verdict, V.UNKNOWN);
});

// ── ★ expectedTaskNames — the DERIVATION that replaced the hardcoded list ────
test("★ expected tasks are DERIVED from the register scripts, not hand-listed", () => {
  // The hardcoded list said 3 while the scripts create 6, so three absent tasks — including
  // the Tier-C runner — read as `all_registered`. Deriving is what makes drift impossible.
  const names = expectedTaskNames();
  assert.ok(names.length >= 6, `expected >=6 derived task names, got ${names.length}: ${names}`);
  assert.ok(names.includes("TF-CI-Runner"), "the Tier-C runner task must be expected — it is the headline gap");
  assert.ok(names.includes("TF-Rails-Divergence") && names.includes("TF-Rails-WorktreeTTL"));
  for (const rel of REGISTER_SCRIPTS) assert.ok(fs.existsSync(path.resolve(process.cwd(), rel)), `missing ${rel}`);
});
test("expectedTaskNames returns [] when scripts are unreadable (caller must treat as UNKNOWN)", () => {
  assert.deepEqual(expectedTaskNames("/nonexistent-root", () => "", () => false), []);
});

// ── ★ tierWsl — mutant M3 ("PASS when no distro") lived here ─────────────────
test("★ tierWsl: no distro -> FAIL (the runner task cannot execute)", () => {
  assert.equal(tierWsl({ platform: "win32", spawnFn: spawnOk("", 1) }).verdict, V.FAIL);
});
test("★ tierWsl: real UTF-16LE output is decoded", () => {
  const utf16 = Buffer.from("Ubuntu\r\n", "utf16le").toString("utf-8");
  const r = tierWsl({ platform: "win32", spawnFn: spawnOk(utf16) });
  assert.equal(r.verdict, V.PASS);
  assert.match(r.detail, /1 distro/);
});
test("★ tierWsl: a banner/nag line is NOT a distro — shape is validated", () => {
  const r = tierWsl({ platform: "win32", spawnFn: spawnOk("Windows Subsystem for Linux has no installed distributions.\r\n") });
  assert.equal(r.verdict, V.FAIL, "a prose line was counted as a distro");
});
test("tierWsl: wsl absent -> UNKNOWN", () => {
  assert.equal(tierWsl({ platform: "win32", spawnFn: spawnErr("ENOENT") }).verdict, V.UNKNOWN);
});

// ── ★ tierServices — mutant M6 ("PASS without contacting the service") ───────
test("★ tierServices: unreachable -> FAIL, carrying the cause code", async () => {
  const r = await tierServices({ fetchFn: async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); } });
  assert.equal(r.verdict, V.FAIL);
  assert.equal(r.detail, "ECONNREFUSED", "the cause code must survive — DNS vs refused are different recoveries");
});
test("tierServices: a non-200 still counts as UP (the 07-11 false-positive fix)", async () => {
  const r = await tierServices({ fetchFn: async () => ({ status: 503 }) });
  assert.equal(r.verdict, V.PASS);
  assert.equal(r.reason, "http_503");
});
test("★ tierServices ACTUALLY calls fetch with the health URL", async () => {
  let seen = null;
  await tierServices({ url: "http://x/health", fetchFn: async (u) => { seen = u; return { status: 200 }; } });
  assert.equal(seen, "http://x/health", "the service was never contacted");
});

// ── runChecks: a throwing check must be UNKNOWN, never FAIL ──────────────────
test("★ a check that THROWS is UNKNOWN — a broken checker must not condemn the box", async () => {
  const r = await runChecks([{ leg: "db", tier: "—", label: "x", run: () => { throw new Error("boom"); } }]);
  assert.equal(r[0].verdict, V.UNKNOWN);
  assert.equal(r[0].reason, "check_threw");
});
test("runChecks attaches the per-leg evidence level to every result", async () => {
  const r = await runChecks([{ leg: "wsl", tier: "C", label: "x", run: async () => ({ verdict: V.PASS, reason: "ok" }) }]);
  assert.equal(r[0].evidence, EVIDENCE.wsl);
});

// ── ★ Runsheet honesty — SEMANTIC, not a literal grep ────────────────────────
/**
 * Parse the evidence table into {leg -> evidence cell}. The previous guard grepped for the
 * literal "NOT DRILLED": it went RED on an honest reword and stayed GREEN on a dishonest
 * upgrade that kept the phrase. Parsing the table and classifying the cell is the semantic
 * form — the same literal-vs-semantic lesson as the leg-5 credential guard.
 */
function runsheetEvidence(doc) {
  const out = {};
  for (const line of doc.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    out[cells[0].replace(/\*+/g, "")] = cells[2];
  }
  return out;
}
const DRILL_CLAIM = /drill|receipt/i;
const NOT_DRILLED = /not\s+drilled|pending\s+drill|designed/i;

test("★ the EVIDENCE enum is classified by MEANING — the markdown is not the only claim", () => {
  // Grader mutant M10 SURVIVED the first fix: `"DRILLED 2026-07-20 (previously: not
  // drilled)"` in the enum asserts a drill that never happened while still containing the
  // words "not drilled". My rewrite made the RUNSHEET guard semantic and left the enum with
  // NO honesty assertion at all — the instance fixed, the class left open, one file over
  // from where I fixed it. The enum is printed in every verifier run, so it is a claim.
  for (const leg of ["services", "tasks", "wsl"]) {
    const cell = EVIDENCE[leg];
    assert.ok(NOT_DRILLED.test(cell), `${leg} must state it is not drilled; got "${cell}"`);
    const residual = cell.replace(/not\s+drilled|pending\s+drill|designed/gi, "");
    assert.ok(!DRILL_CLAIM.test(residual), `${leg} smuggles a drill claim: "${cell}"`);
  }
  assert.ok(DRILL_CLAIM.test(EVIDENCE.db), "the DB leg is the one that WAS drilled");
  // and the levels must not collapse into one uniform claim
  assert.ok(new Set(Object.values(EVIDENCE)).size >= 3, "evidence levels went uniform");
});

test("★ every runsheet row that CLAIMS a drill must actually have one", () => {
  const ev = runsheetEvidence(fs.readFileSync(RUNSHEET, "utf8"));
  const claiming = Object.entries(ev).filter(([, c]) => DRILL_CLAIM.test(c) && !NOT_DRILLED.test(c));
  // Only the DB leg has a receipt. Any other row claiming a drill is the exact overreach
  // this document exists to prevent — and a reworded dishonest upgrade is caught here,
  // where a literal grep for "NOT DRILLED" let it through.
  const legs = claiming.map(([k]) => k);
  assert.deepEqual(legs.filter((l) => !/database/i.test(l)), [],
    `these rows claim a drill they do not have: ${legs.join(", ")}`);
});

test("★ the tiers are classified as un-drilled by MEANING, not by an exact phrase", () => {
  const ev = runsheetEvidence(fs.readFileSync(RUNSHEET, "utf8"));
  for (const [k, cell] of Object.entries(ev)) {
    if (/services|scheduled tasks|wsl runner/i.test(k)) {
      assert.ok(NOT_DRILLED.test(cell), `${k} must state it is not drilled; got "${cell}"`);
      // Strip EVERY negation phrase (global) before looking for a residual positive claim —
      // a non-global replace left "NOT DRILLED" behind, whose own "drilled" then read as a
      // drill claim. The check must not trip on the very words that make the row honest.
      const residual = cell.replace(/not\s+drilled|pending\s+drill|designed/gi, "");
      assert.ok(!DRILL_CLAIM.test(residual), `${k} smuggles a drill claim: "${cell}"`);
    }
  }
});

test("★ no blanket drill claim anywhere in the PROSE — the table is not the only surface", () => {
  // Grader mutant M9 added a "cold-box rebuild PASSED" sentence while leaving the header
  // disclaimer intact; a table-only parser never sees it. Any sentence asserting the WHOLE
  // runsheet is drilled is the blanket claim OR-091 forbids.
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  const prose = doc.split("\n").filter((l) => !l.trim().startsWith("|"));
  for (const line of prose) {
    const blanket = /(cold[- ]box|full|end[- ]to[- ]end|whole|entire).{0,40}(rebuild|recovery).{0,30}(drill|passed|verified)/i;
    assert.ok(!blanket.test(line), `blanket drill claim in prose: "${line.trim()}"`);
  }
});

test("★ the runsheet carries the KEY FINDINGs — the payload a drill produces", () => {
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  assert.match(doc, /PostgreSQL 17\.10/, "the drilled DB leg's finding (pg17 vs v16)");
  assert.match(doc, /footer/i, "leg 5's finding (a footer-only read passes on a corrupt object)");
  assert.match(doc, /WSL distro/i, "Tier C's finding (the unlisted prerequisite)");
  assert.match(doc, /TF-CI-Runner/, "the absent runner task must be recorded, not just implied");
});

test("★ the real-incident path is SEPARATE and guarded", () => {
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  assert.match(doc, /Do not run anything in this section as part of a rehearsal/i);
  assert.match(doc, /operator-only/i);
  assert.match(doc, /disaster-recovery-db\.md/, "destructive steps must live elsewhere, not inline");
});

test("the runsheet tells the reader to RUN the verifier", () => {
  const doc = fs.readFileSync(RUNSHEET, "utf8");
  assert.match(doc, /verify-recovery\.cjs/);
  assert.match(doc, /exit/i);
});

test("every CHECKS entry has a declared evidence level", () => {
  for (const c of CHECKS) {
    assert.ok(c.leg && c.label && typeof c.run === "function");
    assert.ok(EVIDENCE[c.leg], `check "${c.leg}" would print an undefined evidence claim`);
  }
});
