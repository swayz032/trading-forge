// RED-PROOF (R-544 s3 item 9). The runner is only a GATE if every forbidden outcome has a
// DEMONSTRATED path to a non-zero exit, and the unmutated control still exits 0.
//
//   "A GREEN CHECK WITH NO PATH TO RED" is the defect this file closes. A stop condition
//   owes a fixture that DISCRIMINATES -- it must go RED without the guard and GREEN with it.
//
// Each row below plants ONE real defect (a broken fixture, a rejected green, a non-identical
// twin, a genuinely CommonJS emitted artifact, a real broken compilation root) and asserts:
//   1. the runner exits NON-ZERO, and
//   2. the failure it names is the class we planted -- not some other class that happened
//      to trip. A mutation caught by the wrong check is a failed proof here too.
//
// The CONTROL is the discriminator: without it this file could not tell "detects breakage"
// from "always red".
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { extractModuleCollections } from './module-collections.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'run.mjs');
const FREEZE = path.join(HERE, 'emitted-freeze.mjs');

const CLASSES = [
  ['wrong_catcher', 'a fixture reddens via a catcher other than its named one'],
  ['ownership', 'the named catcher fires but a competing catcher also fires'],
  ['parse', 'a fixture does not parse'],
  ['green_rejected', 'a GREEN neighbour is rejected'],
  ['neg_control', 'the negative control fails to convict'],
  ['getter', 'a getter is invoked during admission'],
  ['ledger_read', 'the run opens the membership ledger or ORACLE.json'],
  ['surface_health', 'the pinned compiler surface does not compile'],
  ['twin', 'the twin arms are no longer byte-identical'],
  ['tuple_disagreement', 'my module-format derivation disagrees with ts.impliedNodeFormat'],
  ['emitted_module', 'the emitted ESM artifact is not actually ESM'],
  // R-546 §5.0 / §6 / §7 — the partition's own stop conditions.
  ['surface_invalid_rows', 'a row is SURFACE-INVALID after item 2, making the number inadmissible'],
  ['position_unclassified', 'an identifier position cannot be classified as type or value'],
  ['type_invalid_unclassified', 'a semantic diagnostic falls in none of the declared classes'],
  ['fixture_invalid', 'a fixture carries an AUTHORING defect (its own population, formerly unassignable)'],
  // WITHDRAWN CLAIM: I previously declared this class STRUCTURALLY UNREACHABLE and excluded it
  // from the count. The accuracy-validator showed the argument was sound about STATUSES and
  // silent about IDS — a duplicate corpus id puts one id in the partition twice. It is a
  // normal red-proofed class now.
  ['partition_overlap', 'the same id appears in two populations (duplicate corpus id)'],
];

// These classes share ONE injection with a class above, because the planted defect genuinely
// trips both — an orphaned row necessarily makes the six populations sum to less than 52.
// Listed separately so neither is claimed as red-proofed without a witness.
const SHARED = [
  ['partition_orphan', 'wrong_catcher', 'a row lands in none of the six populations'],
  ['partition_sum', 'wrong_catcher', 'the six populations do not sum to 52'],
];

// ---- R-548 §4's SEVEN MANDATORY RED-PROOFS FOR ITEMS 14-16 ----------------------------
// R-547 §4.3: "a guard whose founding defect is not in its mutation set is untested against the
// only failure it has actually seen." (a) and (b) ARE R-548 §2's two executed founding attacks,
// reproduced verbatim as injections rather than described.
// The injection name and the failure-class name differ here (one guard, several ways to breach
// it), so each row states the class it must see NAMED.
const EXPECT = [
  ['own_unrelated_attributed', 'type_invalid_unclassified', '(a) FOUNDING ATTACK A: unrelated TS2339 planted on 35(a) — under the deleted global code list this BOUGHT a caught_by_typechecker credit and exited 0'],
  ['membership_rename',        'membership',                '(b) FOUNDING ATTACK B: unique rename 35(a) -> 35(z), body and expectation byte-untouched — the self-authored set reported missing_ids: [] and exited 0'],
  ['own_unrelated_nonowned',   'type_invalid_unclassified', '(c) unrelated TS2304 on a NON-OWNED row (34(b))'],
  ['own_extra_code',           'type_invalid_unclassified', '(d) an EXTRA code beside a LEGITIMATE compiler-owned mutation (52(a) keeps its real TS1117)'],
  // R-557 §1's constructed reproducer — the founding defect of item 14's THIRD clause. AR-598 §3
  // named this residual in PROSE and the suite stayed 29/29 green, because describing a hole and
  // testing for it are different acts. It is in the mutation set now.
  ['own_extra_inside_anchor',  'type_invalid_unclassified', '(h) R-557: an EXTRA same-code diagnostic SHELTERING INSIDE the declared anchor (34(d-u) param renamed; anchor byte-unchanged) — this exited 0 crediting BOTH'],
  // R-558's reproducer. The row it deletes is the guard for the grader's F-1 CRITICAL, so this
  // class protects the guards against the two worst findings the campaign has made.
  ['membership_delete_guard',  'membership',                '(i) R-558: DELETE guard row 56(a) (the F-1 `export * from` guard) — this exited 0 with declared_but_absent printed and never gated'],
  ['membership_add',           'membership',                '(e) membership ADD: an id not in the pinned EXPANDED set (53e80935) — legitimate growth must bump the pin'],
  ['membership_delete',        'membership',                '(f) membership DELETE: an expected id disappears'],
  ['membership_duplicate',     'membership',                '(g) membership DUPLICATE: the same id twice in the population under test'],
  // R-561's five: the GREEN population was unpinned, and `green_admitted === green_total`
  // compared two operands from the SAME mutable array — it could only ever speak about survivors.
  ['green_delete',             'green_membership',          '(j) R-561 DECISIVE: delete G-src-implements-erased (the control that exists BECAUSE of the F-2 over-correction) — this gave 7/7, GATE: PASS, EXIT 0'],
  ['green_add',                'green_membership',          '(k) an undeclared green arrival not in the pinned green set'],
  ['green_duplicate',          'green_membership',          '(l) the same green id twice'],
  ['green_to_red',             'disposition',               '(m) RED<->GREEN MIGRATION: the id still EXISTS, only its disposition changed — an existence-only check waves this through'],
  // R-562's CLASS SWEEP. (o) is the one that closes the class rather than instance four: a NEW
  // self-certifying array is itself a finding, so instance five announces itself.
  ['twin_pairs_delete',        'twin_pairs_membership',     '(n) R-562: delete a TWIN_PAIRS entry — both rows it names stay ALIVE, so every membership and disposition check passed while the twin assertions went 2 -> 1'],
  ['prereg_delete',            'prereg_membership',         '(o) delete a PREREGISTERED_EMIT_CHANGES key — invisible to emitted-freeze for an EMIT-IDENTICAL row'],
  ['new_unpinned_collection',  'collection_shape',          '(p) THE SET OF SETS: introduce a NEW exported collection nobody pinned — instance five must announce itself'],
  // 🛑★★★★★ R-568 item (5) / AR-607 — INSTANCES SIX AND SEVEN, AND THEY WERE ON THE
  // ENFORCEMENT FILES THEMSELVES. Both were MEASURED before the fix was written:
  //   deleting ONE row from THIS array gave "37 / 37", "VERDICT: ENFORCING GATE", EXIT 0,
  //   with the retired class leaving zero trace in the output; and deleting the
  //   `collection_shape` entry from run.mjs's FAILURE_CLASSES made the `new_unpinned_collection`
  //   injection above report GATE: PASS, EXIT 0 — i.e. row (p) could be silently disarmed.
  // TOGETHER THEY COMPOSE INTO A COORDINATED TWO-EDIT DELETION that removes the R-562 class fix
  // AND its proof with both gates green — the shape R-558 closed for corpus rows and left open
  // here. `A COUNT OF SURVIVING MEMBERS CANNOT SPEAK ABOUT MEMBERS THAT WERE REMOVED.`
  ['substituted_diagnostic',    'type_invalid_unclassified', '(s) GRADE F-3: R-548 attack A in its SUBSTITUTED form — the TRUE plant RESOLVES and an impostor of the same code claims the byte-unchanged anchor. ONE diagnostic, ONE anchor, bijection satisfied; measured to give GATE: PASS EXIT 0 with a partition identical to clean'],
  ['module_collection_delete',  'module_collections',       '(q) R-568(5): delete a row from an ENFORCEMENT TABLE (this EXPECT array) — measured to give 37/37 ENFORCING GATE, EXIT 0'],
  ['module_collection_add',     'module_collections',       '(r) R-568(5): a NEW module-level collection in run.mjs nobody pinned — the set of sets, beyond corpus.mjs'],
  // R-585 §6.1 — MISS_NOT_CAUGHT was UNGATED outside the pinned 52 (AR-615 §4b). Both halves of
  // the tripwire get their own row: a list that can only grow is the defect being avoided.
  ['uncaught_undeclared',       'uncaught_gap',              '(t) R-585: a row OUTSIDE the pinned 52 catches NOTHING and is not declared a known-open gap — this was ungated forever and no failure class spoke'],
  ['uncaught_stale',            'uncaught_gap',              '(u) R-585: a DECLARED known-open gap is NOW CAUGHT — the tripwire must force the declaration to SHRINK rather than persist as a standing excuse'],
];

// R-548 §4 (b) requires the rename to go RED in BOTH `run.mjs` AND `emitted-freeze.mjs`. The
// freeze gate is a SEPARATE process with a separate exit code, so it gets its own witness.
const FREEZE_EXPECT = [
  ['membership_rename', '35(a)', '(b, second gate) the renamed row must not vanish from the freeze denominator'],
  ['membership_delete', '38',    '(f, second gate) a deleted row must not vanish from the freeze denominator'],
];

function runWith(inject, script = RUNNER) {
  try {
    const stdout = execFileSync(process.execPath, [script], {
      encoding: 'utf8', timeout: 180000,
      env: { ...process.env, PROTO_INJECT: inject },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? -1, stdout: e.stdout || '' };
  }
}

// 🛑★★★★★ F-1c (THIRD INDEPENDENT GRADE, 2026-08-02) — WITNESS PROVENANCE.
//
// THE DEFECT, AND IT WAS MINE: `rows.push({ cls: `${inject}->${cls}` })` MANUFACTURED THE WITNESS
// KEY FROM THE VERY DECLARATION IT WAS CHECKED AGAINST. `DECLARED_ROW_KEYS` is built from EXPECT;
// the recorded key was rebuilt from EXPECT; so the membership test had EXPECT ON BOTH SIDES and
// could only ever prove that EXPECT equals itself. The grader changed WHICH injection runs —
// `runWith(EXPECT.find(([, c]) => c === cls)[0])` — leaving the loop variables intact, and the
// output was BYTE-IDENTICAL to the clean control: 41/41, ENFORCING GATE, EXIT 0, empty `diff`,
// while ELEVEN OF NINETEEN red paths were retired.
//
//     A WITNESS DERIVED FROM THE DECLARATION IT IS CHECKED AGAINST IS A TAUTOLOGY, NOT A WITNESS.
//
// ⚠️ THIS IS THE THIRD FORM OF ONE SPECIES, AND THE PROGRESSION IS THE REAL FINDING:
//     R-561  both operands from the same MUTABLE ARRAY
//     R-578  CARDINALITY asserted where IDENTITY was needed
//     R-582  both operands from the same DECLARATION
// Each fix moved the defect one level up instead of out of the file. THIS one moves the SOURCE of
// the key outside `red-proof.mjs` entirely: the child process names the injection it ran, and only
// the child can produce that string. The parent stops inventing it.
const CONTROL_PREFIX = '<none';
const observedInjection = (stdout) => {
  const m = stdout.match(/^INJECTION: (.*)$/m);
  return m ? m[1].trim() : null;   // null = the child never declared what it ran
};
// The recorded key is built from `obs` — NEVER from the loop variable. `provenanceOk === false`
// is a LOUD failure in its own right: a missing witness must not degrade into a merely mismatching
// key, because "declared but never ran" would then misdescribe WHICH layer actually broke.
const NO_WITNESS = '«NO INJECTION WITNESS»';
const witnessed = (r) => {
  const obs = observedInjection(r.stdout);
  return { obs, provenanceOk: obs !== null, token: obs === null ? NO_WITNESS : obs };
};
// ⚠️ Provenance is carried ON EACH ROW rather than in a module-level list, and that is a
// deliberate design choice with a measured reason: a new module-level collection would be a NEW
// UNPINNED table (the set-of-sets guard flags it, correctly) and would cost another pin dance.
// Keeping the witness with the row it describes is also simply better — the datum and its subject
// do not drift apart. NOTE this is NOT evading the guard: nothing existing is being hidden from
// it, and the alternative was creating a table with no independent reason to exist.

console.log('RED-PROOF — every enforced class must have a demonstrated red path');
console.log('='.repeat(104));

// ---- THE CONTROL FIRST: unmutated, must be GREEN (exit 0) ----
const control = runWith('');
const controlOk = control.code === 0 && /GATE: PASS/.test(control.stdout);
console.log(`CONTROL (no injection)           exit=${String(control.code).padEnd(3)} ${controlOk ? 'GREEN  <- the discriminator: this suite is not always-red' : '*** CONTROL FAILED — every result below is uninterpretable ***'}`);
console.log('-'.repeat(104));

const rows = [];
for (const [cls, what] of CLASSES) {
  const r = runWith(cls);
  const wentRed = r.code !== 0;
  const namedOurClass = new RegExp(`\\*\\*\\* ${cls}:`).test(r.stdout);
  const gateFail = /GATE: FAIL/.test(r.stdout);
  const w = witnessed(r);
  const ok = wentRed && namedOurClass && gateFail && w.provenanceOk;
  // KEY FROM THE CHILD (`w.token`), never from the loop variable `cls`.
  rows.push({ cls: w.token, ok, code: r.code, namedOurClass, declaredKey: cls, provOk: w.provenanceOk });
  const firedNames = (r.stdout.match(/^ {2}\*\*\* (\w+):/gm) || []).map((s) => s.replace(/^ {2}\*\*\* /, '').replace(':', ''));
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${cls.padEnd(20)} exit=${String(r.code).padEnd(3)} named=[${firedNames.join(',')}]  (${what})`);
}

for (const [cls, viaInject, what] of SHARED) {
  const r = runWith(viaInject);
  const namedOurClass = new RegExp(`\\*\\*\\* ${cls}:`).test(r.stdout);
  const w = witnessed(r);
  const ok = r.code !== 0 && namedOurClass && w.provenanceOk;
  // The SHARED rows ride another class's injection, so the identity is the PAIR
  // (what the child actually ran, which class it named). Only the first half is child-sourced.
  rows.push({ cls: `${w.token}=>${cls}`, ok, code: r.code, namedOurClass, declaredKey: `${viaInject}=>${cls}`, provOk: w.provenanceOk });
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${cls.padEnd(20)} exit=${String(r.code).padEnd(3)} ran '${w.token}' (declared via '${viaInject}')  (${what})`);
}

// ---- ITEMS 14-16: the seven named red-proofs, each naming the class it must trip ------
for (const [inject, cls, what] of EXPECT) {
  const r = runWith(inject);
  const namedOurClass = new RegExp(`\\*\\*\\* ${cls}:`).test(r.stdout);
  const w = witnessed(r);
  const ok = r.code !== 0 && namedOurClass && /GATE: FAIL/.test(r.stdout) && w.provenanceOk;
  // 🛑 THE LINE F-1c IS ABOUT. `w.token` comes from the CHILD's own output; `inject` is the
  // declaration and must never reach this key, or the membership test compares EXPECT to itself.
  rows.push({ cls: `${w.token}->${cls}`, ok, code: r.code, namedOurClass, declaredKey: `${inject}->${cls}`, provOk: w.provenanceOk });
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${inject.padEnd(26)} exit=${String(r.code).padEnd(3)} ran '${w.token}' names '${cls}'=${namedOurClass}  ${what}`);
}

// ---- (b)/(f) SECOND GATE: the freeze comparator must go red on the same mutation ------
// Its CONTROL runs first, because a suite that cannot go green cannot tell you anything about
// its red paths (R-554 §6) — and because without it "always red" is indistinguishable from
// "detects breakage".
const freezeControl = runWith('', FREEZE);
const freezeControlOk = freezeControl.code === 0;
// A CONTROL MUST ALSO PROVE IT IS A CONTROL. Without this, "the control" is just the row we
// chose to call one — an injected run could occupy the control slot and the key would not notice.
const fcW = witnessed(freezeControl);
const fcIsControl = fcW.provenanceOk && fcW.token.startsWith(CONTROL_PREFIX);
console.log(`${freezeControlOk && fcIsControl ? 'PASS' : '*** FAIL'} ${'emitted-freeze CONTROL'.padEnd(26)} exit=${String(freezeControl.code).padEnd(3)} ran '${fcW.token}' (unmutated freeze gate must be GREEN and must witness NO injection)`);
rows.push({ cls: fcIsControl ? 'freeze_control' : `freeze_control(RAN '${fcW.token}')`, ok: freezeControlOk && fcIsControl, code: freezeControl.code, declaredKey: 'freeze_control', provOk: fcW.provenanceOk });
// 🛑★★★★★ F-3b (SECOND INDEPENDENT GRADE, 2026-08-02) — A WITNESS THAT MATCHES THE CLEAN
// CONTROL IS NOT A WITNESS, IT IS A CONSTANT.
//
// THE DEFECT: this loop used `r.stdout.includes(mustName)` with `mustName` = '35(a)' / '38'.
// `'38'` OCCURS SIXTEEN TIMES IN THE UNMUTATED OUTPUT (hex digest substrings), and every item-16
// failure prints `compared 38 source rows`. So BOTH assertions passed under BOTH injections —
// the 2x2 cross-product had EVERY OFF-DIAGONAL CELL GREEN, and `names '38'=true` was evidence of
// nothing at all. This attacks the remedy the campaign relies on everywhere:
//     A NEGATIVE ASSERTION NEEDS A POSITIVE WITNESS THAT THE PATH RAN
// and a witness satisfied by the clean control proves only that the program printed something.
//
// ✅ THE FIX IS DISCRIMINATION, PROVEN IN THREE PARTS AND ALL THREE ARE REQUIRED:
//   1. ABSENT-FROM-CONTROL: the token must NOT appear in the unmutated freeze output. Asserted
//      here, not assumed — if it ever becomes a constant again, THIS is the check that says so.
//   2. PRESENT-UNDER-ITS-OWN injection.
//   3. ABSENT-UNDER-EVERY-OTHER injection — the cross-product must be DIAGONAL.
// The token is no longer the bare id but the id IN ITS STOP-CONDITION SENTENCE, which cannot be
// produced by a digest substring:  `*** STOP CONDITION (item 16): <id>: ABSENT`
const freezeWitness = (id) => new RegExp(`\\*\\*\\* STOP CONDITION \\(item 16\\): ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: ABSENT`);
const freezeRuns = FREEZE_EXPECT.map(([inject]) => ({ inject, r: runWith(inject, FREEZE) }));
for (let i = 0; i < FREEZE_EXPECT.length; i++) {
  const [inject, mustName, what] = FREEZE_EXPECT[i];
  const { r } = freezeRuns[i];
  const w = freezeWitness(mustName);
  const absentFromControl = !w.test(freezeControl.stdout);
  const selfNamed = w.test(r.stdout);
  const offDiagonal = freezeRuns.filter((run, j) => j !== i && w.test(run.r.stdout)).map((run) => run.inject);
  const named = absentFromControl && selfNamed && offDiagonal.length === 0;
  const fw = witnessed(r);
  const ok = r.code !== 0 && named && fw.provenanceOk;
  rows.push({ cls: `freeze:${fw.token}`, ok, code: r.code, namedOurClass: named, declaredKey: `freeze:${inject}`, provOk: fw.provenanceOk });
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${`freeze:${inject}`.padEnd(26)} exit=${String(r.code).padEnd(3)}`
    + ` witness '${mustName}': absent-from-control=${absentFromControl} present-under-own=${selfNamed}`
    + ` leaked-to=[${offDiagonal.join(',')}]  ${what}`);
  if (!absentFromControl) {
    console.log(`***   STOP CONDITION (F-3b): witness for '${mustName}' ALSO MATCHES THE CLEAN CONTROL —`
      + ' it is a constant, not a witness, and can certify nothing.');
  }
}

// ---- THE OVER-CORRECTION CONTROL (R-548 §4: "legitimately compiler-owned rows must STAY
// ---- GREEN — a fix that convicts them has over-corrected") -----------------------------
// Re-measured from the control run in THIS process, never inherited: R-555 §3 is now campaign
// law — a red path is a property of the guard AND the current code, and so is a green one.
const ownedStillGreen = /"caught_by_typechecker": 5/.test(control.stdout);
const ownedRowsNamed = ['52(a)', '52(b)', '52(c)', '52(d)', '54(c)'].every((id) => control.stdout.includes(`${id}     CAUGHT_BY_TYPECHECKER`) || new RegExp(`${id.replace(/[()]/g, '\\$&')}\\s+CAUGHT_BY_TYPECHECKER`).test(control.stdout));
// Same provenance discipline as the freeze control: this row reads the run.mjs CONTROL, so the
// control must witness that it ran NO injection before its greenness means anything.
const occW = witnessed(control);
const occIsControl = occW.provenanceOk && occW.token.startsWith(CONTROL_PREFIX);
const overCorrectionOk = controlOk && ownedStillGreen && ownedRowsNamed && occIsControl;
console.log(`${overCorrectionOk ? 'PASS' : '*** FAIL'} ${'over_correction_control'.padEnd(26)} the 5 legitimately compiler-owned rows STAY credited under the row-bound join (count=${ownedStillGreen}, rows=${ownedRowsNamed}, control ran '${occW.token}')`);
rows.push({ cls: occIsControl ? 'over_correction_control' : `over_correction_control(RAN '${occW.token}')`, ok: overCorrectionOk, code: control.code, declaredKey: 'over_correction_control', provOk: occW.provenanceOk });

// ⚠️ WITHDRAWN, 2026-08-02: this file previously declared `partition_overlap` STRUCTURALLY
// UNREACHABLE and excluded it from the count. The accuracy-validator refuted that — the
// argument was sound about STATUSES and silent about IDS. It is a normal red-proofed class
// above now. `A GUARD I CANNOT TRIP MAY BE A GUARD I HAVE NOT TRIED HARD ENOUGH TO TRIP.`
console.log('='.repeat(104));
// 🛑★★★★★ F-1 (INDEPENDENT GRADE 2026-08-02, INSTANCE NINE) — THE DENOMINATOR NOW COMES FROM
// THE DECLARATIONS AND NEVER FROM THE ACCUMULATOR.
//
// THE DEFECT, MEASURED BY THE GRADER AND REPRODUCED BY THE DESK (R-575 §2): a TWELVE-BYTE edit
// at a LOOP HEAD — `of EXPECT` -> `of EXPECT.slice(0, 1)` — turned this line into
//     "CONTROL GREEN: true | CLASSES WITH A DEMONSTRATED RED PATH: 23 / 23"
//     "VERDICT: the runner is an ENFORCING GATE"   EXIT 0
// EIGHTEEN RED PATHS DISAPPEARED AND THE INSTRUMENT CERTIFIED ITSELF AN ENFORCING GATE.
//
// ⚠️ AND IT IS NOT A NINTH COPY OF THE OLD DEFECT — IT IS A NEW SEAM, WHICH IS WHY EIGHT PRIOR
// INSTANCES DID NOT PREDICT IT:
//     THE PIN FREEZES THE DECLARATION; THE COUNT READS THE CONSUMPTION.
// `AR-607` pinned `CLASSES`/`SHARED`/`EXPECT`/`FREEZE_EXPECT` and the pin was WORKING — the
// declaration was BYTE-IDENTICAL and `checkPinnedCollections` correctly returned `[]`. `rows` is
// a RUNTIME ACCUMULATOR built by iterating those tables, so both operands of `x / rows.length`
// moved together while the pinned text never changed.
//
// 🛑 R-575 §5 FORBIDS THE OBVIOUS NEAR-MISS AND IT IS RIGHT: pinning `rows` would be meaningless,
// because `rows` is BUILT. The fix is the one `type-value-proof.mjs:125` (`pass === CASES.length`)
// and `emitted-freeze.mjs:142` (`rows.length === EXPECTED_SOURCE_COUNT`) already use, and the
// grade proved the boundary by exclusion: the SAME mutation reds both siblings.
//
// ✅ THE TWO MECHANISMS COMPOSE, AND NEITHER IS SUFFICIENT ALONE:
//   edit the DECLARATION  -> `module_collections` convicts it against the pinned artifact
//   edit the CONSUMPTION  -> this count convicts it against the declaration
const STANDALONE_ROWS = 2; // `freeze_control` + `over_correction_control`: pushed outside any loop
const EXPECTED_ROW_COUNT = CLASSES.length + SHARED.length + EXPECT.length + FREEZE_EXPECT.length + STANDALONE_ROWS;
const countOk = rows.length === EXPECTED_ROW_COUNT;
if (!countOk) {
  console.log(`*** STOP CONDITION (F-1): built ${rows.length} rows, expected exactly ${EXPECTED_ROW_COUNT}`
    + ` from the DECLARED tables (CLASSES ${CLASSES.length} + SHARED ${SHARED.length} + EXPECT ${EXPECT.length}`
    + ` + FREEZE_EXPECT ${FREEZE_EXPECT.length} + ${STANDALONE_ROWS} standalone).`
    + ' A red path was RETIRED, not failed — a class that never ran cannot be reported as passing.');
}

// 🛑★★★★★ F-1b (SECOND INDEPENDENT GRADE, 2026-08-02) — CARDINALITY IS NOT IDENTITY.
//
// THE COUNT ABOVE IS NECESSARY AND WAS NEVER SUFFICIENT, and the grader proved it in one edit:
//     `of EXPECT`  ->  `of EXPECT.map(() => EXPECT[1])`
// runs NINETEEN IDENTICAL ROWS, satisfies `rows.length === EXPECTED_ROW_COUNT` against the FULL
// DECLARED DENOMINATOR, and prints "41 / 41" + "the runner is an ENFORCING GATE" + EXIT 0 while
// EIGHTEEN OF NINETEEN RED PATHS ARE RETIRED. The F-1 fix itself waves it through, because
// `rows.push({ cls: ... })` records THE LABEL IT WAS HANDED, never WHICH DECLARED ROW produced it.
//
//     A COUNT IS THE WEAKEST ASSERTION THAT LOOKS LIKE A STRONG ONE.
//
// ⚠️ THE RESIDUAL WAS NAMED BY THIS SEAT FIRST (AR-615 §7.3, `[UNENUMERATED]`) and not converted
// into an ordered item until the grader executed it. Recorded so the shape is not re-learned.
//
// 🛑 R-578 §5 FORBIDS THE NEAR-MISS AND IT IS RIGHT: a DISTINCT-`cls` cardinality check
// (`new Set(rows.map(r => r.cls)).size === 41`) is THE SAME CLASS ONE LAYER UP — still a count.
// The property is MEMBERSHIP, asserted in BOTH directions:
//     every DECLARED key is witnessed EXACTLY ONCE, and no witnessed key is UNDECLARED.
// Substitution fails it (18 keys witnessed 0x, 1 key witnessed 19x); duplication fails it
// (1 key witnessed 2x); retirement fails it (1 key witnessed 0x). None of the three can pass.
const DECLARED_ROW_KEYS = [
  ...CLASSES.map(([cls]) => cls),
  ...SHARED.map(([cls, viaInject]) => `${viaInject}=>${cls}`),
  ...EXPECT.map(([inject, cls]) => `${inject}->${cls}`),
  ...FREEZE_EXPECT.map(([inject]) => `freeze:${inject}`),
  'freeze_control',
  'over_correction_control',
];
const declaredCount = new Map();
for (const k of DECLARED_ROW_KEYS) declaredCount.set(k, (declaredCount.get(k) ?? 0) + 1);
const witnessedCount = new Map();
for (const r of rows) witnessedCount.set(r.cls, (witnessedCount.get(r.cls) ?? 0) + 1);

// Two INDEPENDENT derivations of the same magnitude must agree — if the key list and the
// arithmetic drift apart, the guard itself has rotted and says so rather than picking one.
const derivationsAgree = DECLARED_ROW_KEYS.length === EXPECTED_ROW_COUNT;
// A declared key appearing twice would silently shrink the expected set — the set-of-sets shape.
const declaredNotUnique = [...declaredCount].filter(([, n]) => n !== 1).map(([k, n]) => `${k} (DECLARED ${n}x)`);
const neverWitnessed = [...declaredCount.keys()].filter((k) => (witnessedCount.get(k) ?? 0) === 0);
const witnessedRepeatedly = [...declaredCount.keys()].filter((k) => (witnessedCount.get(k) ?? 0) > 1)
  .map((k) => `${k} (witnessed ${witnessedCount.get(k)}x)`);
const witnessedUndeclared = [...witnessedCount.keys()].filter((k) => !declaredCount.has(k));
// ★★★ PROVENANCE IS A SEPARATE, PRIOR CONDITION — not folded into identity. If a child never
// declared what it ran, the identity comparison is not "failing", it is UNINTERPRETABLE, and the
// two must not print the same way (`R-582`'s whole lesson is about a verdict that misdescribes
// which layer broke).
const identityOk = derivationsAgree && declaredNotUnique.length === 0 && neverWitnessed.length === 0
  && witnessedRepeatedly.length === 0 && witnessedUndeclared.length === 0;
const provenanceFailureRows = rows.filter((r) => r.provOk === false);
const provenanceOk = provenanceFailureRows.length === 0;
if (!provenanceOk) {
  console.log('*** STOP CONDITION (F-1c): a row was recorded WITHOUT a child-printed witness. Its identity'
    + ' would have come from this file\'s own declaration, which is the tautology F-1c closes.');
  for (const r of provenanceFailureRows) console.log(`***   ${r.declaredKey}: the child printed no 'INJECTION:' line — nothing witnesses what it ran`);
}
if (!identityOk) {
  console.log('*** STOP CONDITION (F-1b): the built rows do not MATCH the declared rows one-for-one.'
    + ' A red path can be SUBSTITUTED or DUPLICATED without changing the count, so the count alone'
    + ' cannot speak for coverage.');
  if (!derivationsAgree) console.log(`***   derivations disagree: ${DECLARED_ROW_KEYS.length} declared keys vs ${EXPECTED_ROW_COUNT} counted — the guard itself is inconsistent`);
  if (declaredNotUnique.length) console.log(`***   declared more than once: ${declaredNotUnique.join(', ')}`);
  if (neverWitnessed.length) console.log(`***   DECLARED BUT NEVER RAN (${neverWitnessed.length}): ${neverWitnessed.join(', ')}`);
  if (witnessedRepeatedly.length) console.log(`***   RAN MORE THAN ONCE: ${witnessedRepeatedly.join(', ')}`);
  if (witnessedUndeclared.length) console.log(`***   RAN BUT UNDECLARED: ${witnessedUndeclared.join(', ')}`);
}
// ✅ F-4 (THIRD GRADE) — COMPLETENESS AS AN ENFORCED PROPERTY, NOT MAINTENANCE DISCIPLINE.
// The grade's finding: all of run.mjs's declared FAILURE_CLASSES had a red path, but this file
// contained ZERO non-comment references to FAILURE_CLASSES — so the completeness was TRUE BY CARE,
// and the next class added to run.mjs would silently have no red path here.
//     SAFETY BY STARVATION IS NOT SAFETY BY DESIGN.
// The classes are read from run.mjs's SOURCE (via the same extractor the pin uses) rather than by
// importing it — importing run.mjs would EXECUTE the gate. `keys === null` is a LOUD failure: an
// unreadable declaration must never read as "nothing to cover".
const declaredFailureClasses = extractModuleCollections(fs.readFileSync(RUNNER, 'utf8'), 'run.mjs').get('FAILURE_CLASSES')?.keys ?? null;
const uncoveredFailureClasses = declaredFailureClasses === null
  ? null
  : declaredFailureClasses.filter((k) => !CLASSES.some(([c]) => c === k)
      && !SHARED.some(([c]) => c === k)
      && !EXPECT.some(([, c]) => c === k));
const completenessOk = declaredFailureClasses !== null && uncoveredFailureClasses.length === 0;
if (declaredFailureClasses === null) {
  console.log("*** STOP CONDITION (F-4): run.mjs's FAILURE_CLASSES could not be read — completeness is UNKNOWN, which is not the same as satisfied.");
} else if (uncoveredFailureClasses.length) {
  console.log(`*** STOP CONDITION (F-4): ${uncoveredFailureClasses.length} declared failure class(es) in run.mjs have NO red path here: ${uncoveredFailureClasses.join(', ')}`);
} else {
  console.log(`COMPLETENESS (F-4): all ${declaredFailureClasses.length} of run.mjs's declared FAILURE_CLASSES have a demonstrated red path — ASSERTED, not assumed.`);
}
const allOk = controlOk && countOk && identityOk && provenanceOk && completenessOk && rows.every((r) => r.ok);
// ⚠️ THE DENOMINATOR PRINTED IS THE EXPECTED ONE, NOT `rows.length`. Reporting the accumulator
// beside a check on the accumulator is how "23 / 23" read as complete coverage.
console.log(`CONTROL GREEN: ${controlOk} | CLASSES WITH A DEMONSTRATED RED PATH: ${rows.filter((r) => r.ok).length} / ${EXPECTED_ROW_COUNT}`);
// ⚠️ THE FAILURE REASON MUST NAME THE FAILING PROPERTY. A verdict that only ever lists FAILED
// rows prints an EMPTY reason when the defect is a RETIRED or SUBSTITUTED row — the failure mode
// where every row that ran passed, and the missing ones simply never spoke.
const failedRows = rows.filter((r) => !r.ok).map((r) => r.cls);
console.log(allOk
  ? 'VERDICT: the runner is an ENFORCING GATE — control green, every declared class ran exactly once and red-proofed.'
  : 'VERDICT: NOT a gate. ' + [
    controlOk ? null : 'the CONTROL failed, so no result here is interpretable',
    provenanceOk ? null : `row PROVENANCE missing on ${provenanceFailureRows.length} row(s) — their identity is uninterpretable, not merely wrong`,
    countOk ? null : `row COUNT ${rows.length} != declared ${EXPECTED_ROW_COUNT}`,
    identityOk ? null : `row IDENTITY broken (${neverWitnessed.length} declared class(es) never ran, ${witnessedRepeatedly.length} ran more than once, ${witnessedUndeclared.length} undeclared)`,
    completenessOk ? null : (declaredFailureClasses === null ? 'FAILURE_CLASSES unreadable — completeness UNKNOWN' : `${uncoveredFailureClasses.length} declared failure class(es) have no red path: ${uncoveredFailureClasses.join(', ')}`),
    failedRows.length ? `classes without a demonstrated red path: ${failedRows.join(', ')}` : null,
  ].filter(Boolean).join(' | '));
process.exitCode = allOk ? 0 : 1;
