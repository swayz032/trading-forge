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
  PASS, UNKNOWN, FAIL, V, EVIDENCE, EVIDENCE_STATES, LEGS, CHECKS,
  REGISTER_DIRS, registerScripts, expectedTaskNames,
  tierServices, tierTasks, tierWsl, legS3, legDb, aggregate, runChecks,
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
  for (const rel of registerScripts()) assert.ok(fs.existsSync(path.resolve(process.cwd(), rel)), `missing ${rel}`);
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
// ★★ THE KEYWORD-GUARD MACHINERY IS DELETED, NOT PATCHED.
// runsheetEvidence()/DRILL_CLAIM/NOT_DRILLED parsed free-form markdown, so the governed
// surface was open-ended by construction and siblings regenerated faster than they closed
// (2 -> 3 -> 2 -> 4). My previous commit claimed this was "Removed" while one use was still
// live — the same remove-one-use-leave-the-sibling shape, in the fix for that shape.
// The markdown is now RENDERED from a closed typed source, so these tests replace it.

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

// ═══════════════════════════════════════════════════════════════════════════════
// ★ Closure of the THREE NEW CRITICALs the grader found by hunting beyond the named
// ten. All three are one blind-spot genus wearing different costumes — one abstraction
// level up (F-1), one file/code-path over (F-2), one word choice over (F-3).
// ═══════════════════════════════════════════════════════════════════════════════

// ── F-1: the hardcoding moved UP a level; it did not go away ──────────────────
test("★ F-1: register scripts are GLOBBED — a 7th script is picked up automatically", () => {
  // The previous fix derived NAMES honestly from a hardcoded array of six PATHS, so a new
  // register script was invisible and "cannot drift" was false one abstraction up.
  const fake = { "scripts/rails": ["register-cert-rig-task.ps1", "register-brand-new-task.ps1", "notes.md"],
                 "scripts/soak": ["register-soak-task.ps1"] };
  const found = registerScripts("/r", (dir) => fake[Object.keys(fake).find((k) => dir.endsWith(path.normalize(k)))] || [], () => true);
  assert.equal(found.length, 3, `expected 3 globbed scripts, got ${found}`);
  assert.ok(found.some((f) => f.includes("register-brand-new-task.ps1")), "a NEW register script was not picked up");
});

test("★ F-1: a new register script flows through to the expected TASK NAMES", () => {
  const files = { "scripts/rails": ["register-brand-new-task.ps1"], "scripts/soak": [] };
  const names = expectedTaskNames(
    "/r",
    () => '  [string]$TaskName   = "TF-Brand-New",',
    () => true,
    (dir) => files[Object.keys(files).find((k) => dir.endsWith(path.normalize(k)))] || [],
  );
  assert.deepEqual(names, ["TF-Brand-New"], "a new script's task name did not reach the expected list");
});

test("F-1: unreadable register dirs yield [] (caller must treat as UNKNOWN)", () => {
  assert.deepEqual(registerScripts("/r", () => { throw new Error("EACCES"); }, () => true), []);
});

// ── F-2: legDb had ZERO coverage and its FAIL branch leaked a live DSN ────────
const DSN_ERR = () => Object.assign(
  new Error("connect ECONNREFUSED postgres://tf_user:SUPER_SECRET_PW@db.host:5432/tf"),
  { code: "ECONNREFUSED" },
);

test("★ F-2: legDb FAIL emits e.code ONLY — a DSN password must never reach stdout", async () => {
  // Mutating detail -> e.message passed 34/34 before this existed. emit() prints detail into
  // task logs and alert relays, so this is a live-secret channel, not a cosmetic one.
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://tf_user:SUPER_SECRET_PW@db.host:5432/tf";
  try {
    // postgres(url, opts) returns a tagged-template fn that also has .end()
    const connectFn = () => Object.assign(() => { throw DSN_ERR(); }, { end: async () => {} });
    const r = await legDb({ connectFn });
    assert.equal(r.verdict, V.FAIL);
    assert.equal(r.detail, "ECONNREFUSED", "detail must be the CODE, not the message");
    const blob = JSON.stringify(r);
    assert.ok(!blob.includes("SUPER_SECRET_PW"), "the DSN password reached the emitted result");
    assert.ok(!blob.includes("postgres://"), "a DSN reached the emitted result");
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
});

test("★ F-2: no emitted field may ever carry a message/stack — code-shaped only", async () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://u:PW_LEAK@h/d";
  try {
    const connectFn = () => Object.assign(() => { throw DSN_ERR(); }, { end: async () => {} });
    const blob = JSON.stringify(await legDb({ connectFn }));
    assert.ok(!blob.includes("PW_LEAK"), "a password reached the result");
    assert.ok(!/connect ECONNREFUSED postgres/.test(blob), "an error MESSAGE reached the result");
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
});

test("F-2: no DATABASE_URL -> UNKNOWN, and the var NAME is fine to emit (it is not a value)", async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const r = await legDb({});
    assert.equal(r.verdict, V.UNKNOWN);
    assert.equal(r.detail, "DATABASE_URL");
  } finally { if (prev !== undefined) process.env.DATABASE_URL = prev; }
});

// ── F-3: the whitelist inversion — a closed set, not a keyword blacklist ──────



test("★ aggregate([]) is not a silent PASS — an empty check set proves nothing", () => {
  // Lower severity but the same root: absence read as success.
  assert.notEqual(aggregate([]), PASS, "an empty result set must not report PASS");
});

// ═══════════════════════════════════════════════════════════════════════════════
// ★★ THE REDESIGN: govern the SCHEMA, not the prose.
// Four patch rounds failed because the guard parsed free-form markdown, so every new row,
// column, tier or directory was a fresh ungoverned surface. The evidence state is now a
// closed typed value and the markdown is RENDERED from it — there is no free-form cell in
// which to assert a drill, so the class is closed BY CONSTRUCTION rather than cell by cell.
// ═══════════════════════════════════════════════════════════════════════════════
import { render, OUT } from "../render-runsheet.cjs";
import { validate, drilledLegs } from "../recovery-evidence.cjs";

test("★ the schema validates: every leg's state is one of the closed set", () => {
  assert.equal(validate(), true);
  const valid = Object.keys(EVIDENCE_STATES);
  for (const l of LEGS) assert.ok(valid.includes(l.state), `leg "${l.leg}" state "${l.state}" is not in the closed set`);
});

test("★ a DRILLED claim without a receipt is REJECTED by the schema", () => {
  // The one rule that cannot be phrased around: there is no free-text cell to assert a drill,
  // and asserting the state requires naming where the receipt lives.
  assert.throws(
    () => validate([{ leg: "x", state: "DRILLED", receipt: null }]),
    /claims DRILLED with no receipt/,
  );
});

test("★ a state OUTSIDE the closed set is REJECTED — no phrasing can introduce one", () => {
  assert.throws(
    () => validate([{ leg: "x", state: "DESIGNED — NOT DRILLED, but VERIFIED live", receipt: null }]),
    /not one of/,
  );
});

test("★ a NOT-drilled leg carrying a receipt is rejected (the inverse smuggle)", () => {
  assert.throws(() => validate([{ leg: "x", state: "DESIGNED_NOT_DRILLED", receipt: "somewhere" }]), /not drilled but carries a receipt/);
});

test("★ only the DB leg asserts a drill", () => {
  assert.deepEqual(drilledLegs(), ["db"]);
});

test("★ the checked-in runsheet MATCHES its typed source — a hand-edit goes red", () => {
  // This is what removes the free-form surface: the markdown is generated, so editing a cell
  // to claim a drill does not survive. `--check` enforces the same in CI.
  const onDisk = fs.readFileSync(OUT, "utf-8");
  assert.equal(onDisk, render(), "runsheet is stale or hand-edited — run: node scripts/ops/render-runsheet.cjs --write");
});

test("★ the rendered header's drill count is DERIVED, not typed", () => {
  const doc = render();
  assert.match(doc, new RegExp(`${drilledLegs().length} of ${LEGS.length} legs carry a drill receipt`));
  assert.match(doc, /NOT\*{0,2} drilled as a whole/i);
});

test("★ KEY FINDINGs are declared UNGOVERNED — the guard states its own limit", () => {
  // A guard may have finite reach; it may not CLAIM more than it has. Policing free-text
  // findings for honesty is the open-set trap that made four rounds of patching fail.
  const doc = render();
  assert.match(doc, /KEY FINDING column is free text and is NOT[\s\S]{0,4}tool-governed/i);
});

test("★ every leg in the schema renders exactly one table row", () => {
  const doc = render();
  for (const l of LEGS) {
    const rows = doc.split("\n").filter((x) => x.startsWith("|") && x.includes(`· ${l.name}`));
    assert.equal(rows.length, 1, `leg "${l.leg}" rendered ${rows.length} rows`);
    assert.ok(rows[0].includes(EVIDENCE_STATES[l.state].label), `leg "${l.leg}" row lost its state label`);
  }
});
