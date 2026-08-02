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
import path from 'node:path';

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
  const ok = wentRed && namedOurClass && gateFail;
  rows.push({ cls, ok, code: r.code, namedOurClass });
  const firedNames = (r.stdout.match(/^ {2}\*\*\* (\w+):/gm) || []).map((s) => s.replace(/^ {2}\*\*\* /, '').replace(':', ''));
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${cls.padEnd(20)} exit=${String(r.code).padEnd(3)} named=[${firedNames.join(',')}]  (${what})`);
}

for (const [cls, viaInject, what] of SHARED) {
  const r = runWith(viaInject);
  const namedOurClass = new RegExp(`\\*\\*\\* ${cls}:`).test(r.stdout);
  const ok = r.code !== 0 && namedOurClass;
  rows.push({ cls, ok, code: r.code, namedOurClass });
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${cls.padEnd(20)} exit=${String(r.code).padEnd(3)} via inject '${viaInject}'  (${what})`);
}

// ---- ITEMS 14-16: the seven named red-proofs, each naming the class it must trip ------
for (const [inject, cls, what] of EXPECT) {
  const r = runWith(inject);
  const namedOurClass = new RegExp(`\\*\\*\\* ${cls}:`).test(r.stdout);
  const ok = r.code !== 0 && namedOurClass && /GATE: FAIL/.test(r.stdout);
  rows.push({ cls: `${inject}->${cls}`, ok, code: r.code, namedOurClass });
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${inject.padEnd(26)} exit=${String(r.code).padEnd(3)} names '${cls}'=${namedOurClass}  ${what}`);
}

// ---- (b)/(f) SECOND GATE: the freeze comparator must go red on the same mutation ------
// Its CONTROL runs first, because a suite that cannot go green cannot tell you anything about
// its red paths (R-554 §6) — and because without it "always red" is indistinguishable from
// "detects breakage".
const freezeControl = runWith('', FREEZE);
const freezeControlOk = freezeControl.code === 0;
console.log(`${freezeControlOk ? 'PASS' : '*** FAIL'} ${'emitted-freeze CONTROL'.padEnd(26)} exit=${String(freezeControl.code).padEnd(3)} (unmutated freeze gate must be GREEN)`);
rows.push({ cls: 'freeze_control', ok: freezeControlOk, code: freezeControl.code });
for (const [inject, mustName, what] of FREEZE_EXPECT) {
  const r = runWith(inject, FREEZE);
  const named = new RegExp(`STOP CONDITION \\(item 16\\)`).test(r.stdout) && r.stdout.includes(mustName);
  const ok = r.code !== 0 && named;
  rows.push({ cls: `freeze:${inject}`, ok, code: r.code, namedOurClass: named });
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${`freeze:${inject}`.padEnd(26)} exit=${String(r.code).padEnd(3)} names '${mustName}'=${named}  ${what}`);
}

// ---- THE OVER-CORRECTION CONTROL (R-548 §4: "legitimately compiler-owned rows must STAY
// ---- GREEN — a fix that convicts them has over-corrected") -----------------------------
// Re-measured from the control run in THIS process, never inherited: R-555 §3 is now campaign
// law — a red path is a property of the guard AND the current code, and so is a green one.
const ownedStillGreen = /"caught_by_typechecker": 5/.test(control.stdout);
const ownedRowsNamed = ['52(a)', '52(b)', '52(c)', '52(d)', '54(c)'].every((id) => control.stdout.includes(`${id}     CAUGHT_BY_TYPECHECKER`) || new RegExp(`${id.replace(/[()]/g, '\\$&')}\\s+CAUGHT_BY_TYPECHECKER`).test(control.stdout));
const overCorrectionOk = controlOk && ownedStillGreen && ownedRowsNamed;
console.log(`${overCorrectionOk ? 'PASS' : '*** FAIL'} ${'over_correction_control'.padEnd(26)} the 5 legitimately compiler-owned rows STAY credited under the row-bound join (count=${ownedStillGreen}, rows=${ownedRowsNamed})`);
rows.push({ cls: 'over_correction_control', ok: overCorrectionOk, code: control.code });

// ⚠️ WITHDRAWN, 2026-08-02: this file previously declared `partition_overlap` STRUCTURALLY
// UNREACHABLE and excluded it from the count. The accuracy-validator refuted that — the
// argument was sound about STATUSES and silent about IDS. It is a normal red-proofed class
// above now. `A GUARD I CANNOT TRIP MAY BE A GUARD I HAVE NOT TRIED HARD ENOUGH TO TRIP.`
console.log('='.repeat(104));
const allOk = controlOk && rows.every((r) => r.ok);
console.log(`CONTROL GREEN: ${controlOk} | CLASSES WITH A DEMONSTRATED RED PATH: ${rows.filter((r) => r.ok).length} / ${rows.length}`);
console.log(allOk
  ? 'VERDICT: the runner is an ENFORCING GATE — control green, every class red-proofed.'
  : 'VERDICT: NOT a gate. Classes without a demonstrated red path: ' + rows.filter((r) => !r.ok).map((r) => r.cls).join(', '));
process.exitCode = allOk ? 0 : 1;
