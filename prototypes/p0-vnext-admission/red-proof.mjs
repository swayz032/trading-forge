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
import { createHash } from 'node:crypto';
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

// 🛑★★★★★ THE PINNED EFFECT EXPECTATION — AND IT DECLARES **BOTH** OF ITS AXES (R-587 §3, BINDING).
//
// WHY BOTH, MEASURED RATHER THAN ARGUED: the fifth grade's F-1 (CRITICAL, instance ELEVEN) found
// `module-collections.mjs` had given the self-declaring law to its TABLE axis and left its FILE
// axis bare — `DECLARED_TABLE_TOTAL` is a literal that THROWS when contradicted, while the file
// count beside it was `Object.keys(...).length`, asserted against nothing. Three edits retired a
// whole enforcement file with every gate green.
//     A NEW SELF-CERTIFYING COLLECTION OWES THE LAW TO EVERY AXIS IT HAS, NOT TO THE ONE THAT
//     FAILED LAST TIME.
// This collection has exactly two axes and both are declared here:
//   VALUES      — each digest, pinned (and asserted PAIRWISE DISTINCT + BODY-COVERING below).
//   CARDINALITY — `DECLARED_EFFECT_DIGEST_COUNT`, a literal in the `DECLARED_TABLE_TOTAL:158-161`
//                 shape that THROWS on disagreement, never the `Object.keys().length:376` shape
//                 that F-1 convicted. Deleting an entry to silence a collision must therefore
//                 edit a number that states its own magnitude.
//
// ⚠️ THE KEY IS THE CHILD'S OWN `INJECTION:` TOKEN, transcribed verbatim — including the control's
// sentence, em dash and all. That is deliberate: the control is a MEMBER of this set, not an
// exception to it, and its entry is what makes the two controls fingerprint the ARTIFACT rather
// than the env var they were invoked with (R-585 §3).
// ⚠️ VALUES ARE GENERATED FROM THE CHILD AND TRANSCRIBED, NEVER HAND-COPIED FROM A REPORT — a
// hand-copied expected value is a fabricated safety claim. Regenerate after any change to run.mjs
// or corpus.mjs; a legitimate change SHOULD move these, and moving them must cost a visible edit.
const PINNED_EFFECT_DIGESTS = Object.freeze({
  "<none — this is the clean control>": 'c5eb7df2c8c4d6ccffdc993e15b1e55b3978641112aa44be2cb21a4a8c0c51f4',
  "wrong_catcher": '5e2fc27318ad2bcb26eef4c1e3c9391207f1a5423602e77a4a33ab78d53cd82e',
  "ownership": '1c4960834a8cb81313ae22248acfb5c6b1b8931848f7a20d8f4f5e2a55a9b7c0',
  "parse": 'faf87d9cfd403205170f5bd323c76bba0098c66d40ffa24135f5fc12538253fa',
  "green_rejected": '846aef4556ebb23a3b760c9107090b432ee80253252c890b0d91593cb9db4024',
  "neg_control": '840067911c2206b9ac435c5a2cb184744a7b164f0af9a8959cb1957dbc06c133',
  "getter": '14568f293edc53b6cb6fe70ea512effc8962ce9f86cede4bf235452a01d5582a',
  "ledger_read": 'ff8a8114e4132a0f79df36f0d773953b9e66f4c620cdb66d3e6cca36cb67ad24',
  "surface_health": '3d37a647831552eaaf935c6fb9c116a8974dbfb8c4ae36e6d0cf2a7a45787ac0',
  "twin": '5cd3a80b6e3566643880fafd5bbecb9d4f79c8538f405b90c9cda04c559f1012',
  "tuple_disagreement": '746d6f5994d54e00d2d4780d7f2eeac2ec7b3e71f3a62ec66916101b697dfa4b',
  "emitted_module": 'b7abc0bfb3f1f72c2647ec7f0c32e1800c844f94320f88d1192f8aa57a1b9d46',
  "surface_invalid_rows": '256934d2b600b7a708c4498fc3039b86b2703ea29de3107127f5e918a99d297b',
  "position_unclassified": '8ac7bb03a552b8546f906437b7872b5dd550052cb539e50ead4d463095558a21',
  "type_invalid_unclassified": 'a5124c3f942a5f24380446857262ddd7f4ec4b8db1276c46dff5cf189ffc838a',
  "fixture_invalid": '5a9521c2f1fa207703c6413682b0213b50461bc6084b4039538152f4356c6a30',
  "partition_overlap": 'da994bf0d6012445b5d4504cabb1ffcd8fb2a0b7668a0face30e330f8449e199',
  "own_unrelated_attributed": 'c036170af6016cbd0294b5dcab27ad8ea425cbc5355a6cee488400cef8667695',
  "membership_rename": '9ac917bc80faf2f515701d14fad70d3c746a80a99194312b15efadec810511ef',
  "own_unrelated_nonowned": '1d770809732bbc410652656a55cd27dd83a48670e3998103515df08c1eae95ec',
  "own_extra_code": '9d2af9ad282b93b78a38d8fc796ccc5b04222bf82e74c34bfb9ccb66c5380e13',
  "own_extra_inside_anchor": 'bc351c3c4e0b32b2d15c7a3fd388aeb2a82ec78216e179bd528945aa798c0ec5',
  "membership_delete_guard": '22b93b783c190999e551c8a15012a4e3a6ef1288ff52ff4867e300a975b87549',
  "membership_add": '780fcb8fa4e8918b1fd780513bb55f184f6eb6d964b92c33dd891d20dda074db',
  "membership_delete": 'e897633b6f5d0399bf12d5a8eb2459bf80a269d2574c793c05242488663d6922',
  "membership_duplicate": '3a1e47489209f833d2b38f3c9c3366c195bab6a0b7eac698602ce41a33d73a26',
  "green_delete": '3604b56b26bd80ae51a9346490cbe7ffb2121d55a6fcdffa5b96378ba949ea63',
  "green_add": 'f36bc45c137cb47439633cd775a2df884b00afea7458d2533c0b8c09762f0538',
  "green_duplicate": '09d87c629b0c301eb18da932848d44a55e9d12423172dbf4fda1e538540ecf30',
  "green_to_red": '064812cfdd5dc58c2d3e67153c692fef6e40e90a6cb5859a0566104729ae5b01',
  "twin_pairs_delete": '3dfdcddb39821cdf800fa583605c8eaf120b0e7b14fde85f1f437c7dcf30486c',
  "prereg_delete": '2eff1213f0eca21ee1f3d88fce1580f28a1d3d825801c5683e4b8cb6b0404064',
  "new_unpinned_collection": 'fae85395482f9bdd4dc7c4abf7d39eef0980c5cd1119716e9bdeb5e889b37511',
  "substituted_diagnostic": '460222aad1a0b50e1a897d4770452ba01a522db3ca4939d715b55bf94411c57e',
  "module_collection_delete": 'e0d5a53b51a06f5e7deeaf4d9458661c01397ac42d4064fd89329c50f0c4e27d',
  "module_collection_add": '67ba9827bd50af5270bbd2100310edfc84a329019ec5603d14a8f9c7c674fcba',
  "uncaught_undeclared": 'd9d98b7ad8399556fad154569f367610f410359cd06da7707911258e1c4e218e',
  "uncaught_stale": 'ba39827f4d69f11adde35e2401072bd64996a7567fb2cfdeeb811b7e6e9de424',
});
// THE SECOND AXIS. A literal that states its own magnitude and THROWS when contradicted — the
// `DECLARED_TABLE_TOTAL` shape, not the `Object.keys().length` shape F-1 convicted. This throws at
// module load, so a shrunk pin cannot reach a verdict at all, let alone a green one.
const DECLARED_EFFECT_DIGEST_COUNT = 38;
if (Object.keys(PINNED_EFFECT_DIGESTS).length !== DECLARED_EFFECT_DIGEST_COUNT) {
  throw new Error('INSTRUMENT FAULT: effect-digest pin magnitudes disagree — PINNED_EFFECT_DIGESTS'
    + ` holds ${Object.keys(PINNED_EFFECT_DIGESTS).length} entries, DECLARED_EFFECT_DIGEST_COUNT says`
    + ` ${DECLARED_EFFECT_DIGEST_COUNT}. An entry was added or silently dropped; no verdict from this run is interpretable.`);
}

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

// 🛑★★★★★ R-585 §6.2 / R-586 §3 / R-587 §3 — LEVEL FIVE: IDENTITY FROM OBSERVED EFFECT.
//
// THE DEFECT F-1c LEFT BEHIND. F-1c moved the witness OUT of this file — the child now names the
// injection it ran, and the parent stopped inventing it. The fifth grade showed that was still one
// level short: `run.mjs:38` reads `PROTO_INJECT` and `run.mjs:*` prints it straight back, so
//     THE CHILD DOES NOT WITNESS WHAT IT *RAN*; IT ECHOES WHAT IT WAS *ASKED* TO RUN.
// Two one-token edits in run.mjs's dispatch — `'56(a)'`->`'38'` and `'34(b)'`->`'35(a)'` — each
// collapsed a declared red path onto ANOTHER row's mutation with red-proof.mjs BYTE-UNTOUCHED, and
// produced 41/41, ENFORCING GATE, EXIT 0, stdout byte-identical to the clean control.
//
// ⚠️ FOUR REMEDIES ASKED "IS THE LABEL TRUSTWORTHY?" (R-585 §2). The attack was always "CHANGE WHAT
// THE LABEL REFERS TO", so a fifth patch of that shape was a predictable sixth grade. THE ORDER
// CHANGED KIND:
//     A ROW'S IDENTITY IS A FUNCTION OF THE OBSERVED EFFECT OF ITS INJECTION, NEVER OF ANY LABEL
//     ANYONE — PARENT OR CHILD — ATTACHES TO IT.
// The child hashes the input surfaces it ACTUALLY BUILT and emits `EFFECT-DIGEST:`. This file only
// ever TRANSCRIBES and COMPARES that value — it never computes one, because a digest computed here
// would rebuild the R-582 tautology one layer down (R-585 §6a, STOP).
//
// ✅ THREE PROPERTIES, AND EACH CATCHES SOMETHING THE OTHER TWO DO NOT:
//   PAIRWISE DISTINCT — two rows collapsing onto one mutation get the SAME fingerprint and RED,
//                       whatever they were called. This is the one that kills the whole species.
//   DETERMINISTIC     — the same injection run twice must fingerprint identically, or "distinct"
//                       would be satisfied by noise and would certify nothing.
//   PINNED            — an injection whose effect CHANGED to something no other row produces stays
//                       distinct, so distinctness alone cannot see it. The pin can.
// ★★★ AND THE CONTROL IS IN THE SET, WHICH IS THE PART THAT GIVES `run.mjs:312` A PROGRAM: an
// injection that plants NOTHING fingerprints exactly like the clean control, COLLIDES WITH IT, and
// reddens. "AN INJECTION THAT DID NOT LAND PRODUCES A GREEN INDISTINGUISHABLE FROM A GUARD THAT DID
// NOT FIRE" stops being a sentence in a comment and becomes a failing assertion (`document-vs-program`).
const observedEffect = (stdout) => {
  const m = stdout.match(/^EFFECT-DIGEST: ([0-9a-f]{64})$/m);
  return m ? m[1] : null;
};
const effectByToken = new Map();
const effectMissing = [];
// Keyed by the CHILD's own token, exactly as F-1c requires — the declaration never supplies a key.
const recordEffect = (token, r) => {
  const d = observedEffect(r.stdout);
  if (d === null) { effectMissing.push(token); return; }
  if (!effectByToken.has(token)) effectByToken.set(token, new Set());
  effectByToken.get(token).add(d);
};

console.log('RED-PROOF — every enforced class must have a demonstrated red path');
console.log('='.repeat(104));

// ---- THE CONTROL FIRST: unmutated, must be GREEN (exit 0) ----
const control = runWith('');
const controlOk = control.code === 0 && /GATE: PASS/.test(control.stdout);
// The control is a MEMBER of the effect set, not an exception to it — that is what lets an
// injection which planted nothing collide with it.
recordEffect(witnessed(control).token, control);
console.log(`CONTROL (no injection)           exit=${String(control.code).padEnd(3)} ${controlOk ? 'GREEN  <- the discriminator: this suite is not always-red' : '*** CONTROL FAILED — every result below is uninterpretable ***'}`);
console.log('-'.repeat(104));

const rows = [];
for (const [cls, what] of CLASSES) {
  const r = runWith(cls);
  const wentRed = r.code !== 0;
  const namedOurClass = new RegExp(`\\*\\*\\* ${cls}:`).test(r.stdout);
  const gateFail = /GATE: FAIL/.test(r.stdout);
  const w = witnessed(r);
  recordEffect(w.token, r);
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
  // The SHARED rows re-run a class already run above, so this is a free DETERMINISM witness: the
  // same injection must fingerprint identically, or "pairwise distinct" is satisfied by noise.
  recordEffect(w.token, r);
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
  recordEffect(w.token, r);
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
// 🛑★★★★★ R-585 §3 — A CONTROL MUST FINGERPRINT THE **ARTIFACT**, NOT THE ENV IT WAS INVOKED WITH.
// THE DEFECT, MEASURED BY THE FOURTH GRADE: in BOTH of its attacks this control printed
// `PASS … control ran '<none — this is the clean control>'` WHILE A LIVE MUTATION SAT IN run.mjs.
//     `CONTROL GREEN: true` IS A STATEMENT ABOUT THE ENVIRONMENT, NEVER ABOUT THE ARTIFACT.
// `emitted-freeze.mjs` is a SEPARATE program with no effect ledger of its own, so its control
// fingerprints the artifact the only way available here: the file's own content.
const PINNED_FREEZE_SHA = 'a4da4708a7a5fba7b3b62b19ee8092b03a46fd150d54ba22e2fe5847c81c315c';
const freezeSha = createHash('sha256').update(fs.readFileSync(FREEZE)).digest('hex');
const freezeArtifactOk = freezeSha === PINNED_FREEZE_SHA;
if (!freezeArtifactOk) {
  console.log(`***   FREEZE ARTIFACT MOVED: pinned ${PINNED_FREEZE_SHA.slice(0, 12)}… but the file on disk is`
    + ` ${freezeSha.slice(0, 12)}… — the control certifies the environment it was invoked with, not this artifact.`);
}
const fcIsControl = fcW.provenanceOk && fcW.token.startsWith(CONTROL_PREFIX) && freezeArtifactOk;
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
// R-585 §3, and here the artifact fingerprint is the STRONGER kind — not the file's bytes but the
// INPUTS the control actually built. A live mutation in run.mjs's dispatch changes what the clean
// run assembles, so this control can no longer pass while a planted defect sits in the artifact.
const occEffect = observedEffect(control.stdout);
const occArtifactOk = occEffect !== null && occEffect === PINNED_EFFECT_DIGESTS[occW.token];
const occIsControl = occW.provenanceOk && occW.token.startsWith(CONTROL_PREFIX) && occArtifactOk;
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
// 🛑★★★★★ THE EFFECT-IDENTITY BLOCK (R-585 §6.2, R-586 §3, R-587 §3). Four checks, and the order
// matters: PRESENCE is prior to DETERMINISM is prior to DISTINCTNESS is prior to the PIN. A missing
// digest is UNINTERPRETABLE rather than wrong, and must never print as a mismatch — that is
// R-582's whole lesson about a verdict misdescribing which layer broke.
const effectPresenceOk = effectMissing.length === 0;
if (!effectPresenceOk) {
  console.log(`*** STOP CONDITION (EFFECT-PRESENCE): ${effectMissing.length} run(s) emitted no 'EFFECT-DIGEST:' line`
    + ' — nothing witnesses what those runs BUILT, so their identity is uninterpretable, not merely wrong.');
  for (const t of effectMissing) console.log(`***   ran '${t}': no effect digest`);
}
// DETERMINISM: a token observed with more than one digest means the fingerprint is noise, and a
// noisy fingerprint satisfies "distinct" for free while certifying nothing.
const nonDeterministic = [...effectByToken].filter(([, ds]) => ds.size > 1)
  .map(([t, ds]) => `${t} (${ds.size} different digests)`);
const effectDeterministicOk = nonDeterministic.length === 0;
// PAIRWISE DISTINCTNESS — the property that kills the species. Two declared rows that collapse onto
// one mutation produce ONE fingerprint, whatever either was called.
const byDigest = new Map();
for (const [t, ds] of effectByToken) for (const d of ds) {
  if (!byDigest.has(d)) byDigest.set(d, []);
  byDigest.get(d).push(t);
}
const effectCollisions = [...byDigest.entries()].filter(([, ts]) => ts.length > 1);
const effectDistinctOk = effectCollisions.length === 0;
// THE PIN, BOTH DIRECTIONS. An effect that CHANGED into something no other row produces stays
// distinct, so distinctness is blind to it and only the pin can speak.
const pinnedKeys = Object.keys(PINNED_EFFECT_DIGESTS);
const witnessedTokens = [...effectByToken.keys()];
const effectUnpinned = witnessedTokens.filter((t) => !(t in PINNED_EFFECT_DIGESTS));
const effectNeverRan = pinnedKeys.filter((k) => !effectByToken.has(k));
const effectChanged = witnessedTokens.filter((t) => t in PINNED_EFFECT_DIGESTS
  && ![...effectByToken.get(t)].every((d) => d === PINNED_EFFECT_DIGESTS[t]))
  .map((t) => `${t}: pinned ${PINNED_EFFECT_DIGESTS[t].slice(0, 12)}… observed ${[...effectByToken.get(t)].map((d) => d.slice(0, 12) + '…').join(' / ')}`);
const effectPinOk = effectUnpinned.length === 0 && effectNeverRan.length === 0 && effectChanged.length === 0;
const effectOk = effectPresenceOk && effectDeterministicOk && effectDistinctOk && effectPinOk;
if (!effectDeterministicOk) {
  console.log(`*** STOP CONDITION (EFFECT-DETERMINISM): ${nonDeterministic.join(', ')} — the same injection`
    + ' fingerprinted differently across runs, so distinctness below would be satisfied by noise.');
}
if (!effectDistinctOk) {
  console.log(`*** STOP CONDITION (EFFECT-COLLISION): ${effectCollisions.length} set(s) of declared rows produced the SAME`
    + ' observed effect. Their identities are not distinguishable by what they DID, only by what they were CALLED —'
    + ' which is exactly the defect this check exists to catch.');
  for (const [d, ts] of effectCollisions) console.log(`***   ${d.slice(0, 16)}…: ${ts.join(', ')}`);
}
if (!effectPinOk) {
  console.log('*** STOP CONDITION (EFFECT-PIN): the observed effects do not match the pinned expectation.');
  if (effectNeverRan.length) console.log(`***   PINNED BUT NEVER RAN (${effectNeverRan.length}): ${effectNeverRan.join(', ')}`);
  if (effectUnpinned.length) console.log(`***   RAN BUT NOT PINNED (${effectUnpinned.length}): ${effectUnpinned.join(', ')}`);
  if (effectChanged.length) console.log(`***   EFFECT CHANGED (${effectChanged.length}): ${effectChanged.join(' | ')}`);
}
console.log(`EFFECT IDENTITY: ${effectByToken.size} distinct injections fingerprinted by OBSERVED EFFECT`
  + ` | pairwise-distinct=${effectDistinctOk} deterministic=${effectDeterministicOk} pinned=${effectPinOk}`
  + ` (declared ${DECLARED_EFFECT_DIGEST_COUNT})`);

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
const allOk = controlOk && countOk && identityOk && provenanceOk && completenessOk && effectOk && rows.every((r) => r.ok);
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
    effectPresenceOk ? null : `EFFECT witness missing on ${effectMissing.length} run(s) — uninterpretable, not merely wrong`,
    effectDeterministicOk ? null : `EFFECT non-deterministic for ${nonDeterministic.length} injection(s)`,
    effectDistinctOk ? null : `EFFECT COLLISION: ${effectCollisions.map(([, ts]) => ts.join('=')).join(', ')} — declared rows that produced the SAME observed effect`,
    effectPinOk ? null : `EFFECT PIN broken (${effectNeverRan.length} pinned never ran, ${effectUnpinned.length} ran unpinned, ${effectChanged.length} changed)`,
    completenessOk ? null : (declaredFailureClasses === null ? 'FAILURE_CLASSES unreadable — completeness UNKNOWN' : `${uncoveredFailureClasses.length} declared failure class(es) have no red path: ${uncoveredFailureClasses.join(', ')}`),
    failedRows.length ? `classes without a demonstrated red path: ${failedRows.join(', ')}` : null,
  ].filter(Boolean).join(' | '));
process.exitCode = allOk ? 0 : 1;
