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
];

// These classes share ONE injection with a class above, because the planted defect genuinely
// trips both — an orphaned row necessarily makes the six populations sum to less than 52.
// Listed separately so neither is claimed as red-proofed without a witness.
const SHARED = [
  ['partition_orphan', 'wrong_catcher', 'a row lands in none of the six populations'],
  ['partition_sum', 'wrong_catcher', 'the six populations do not sum to 52'],
];

function runWith(inject) {
  try {
    const stdout = execFileSync(process.execPath, [RUNNER], {
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

// ---- DECLARED HONESTLY RATHER THAN COUNTED AS PROVEN --------------------------------
// `partition_overlap` is enforced by run.mjs but CANNOT be reached by any injection: the six
// populations are built by filtering on `status`, and a row has exactly one status, so
// membership in two is structurally impossible under the present construction. It is a guard
// against a FUTURE construction change, not a live discriminator.
//   A guard nothing can trip is not red-proofed, and saying "16/16" while quietly counting it
//   would be exactly the inflation this file exists to prevent.
console.log('-'.repeat(104));
console.log("N/A  partition_overlap    STRUCTURALLY UNREACHABLE — one row has exactly one status, so it cannot");
console.log("                          be in two populations. Enforced as a guard against a construction change,");
console.log("                          and DECLARED HERE rather than counted as a demonstrated red path.");

console.log('='.repeat(104));
const allOk = controlOk && rows.every((r) => r.ok);
console.log(`CONTROL GREEN: ${controlOk} | CLASSES WITH A DEMONSTRATED RED PATH: ${rows.filter((r) => r.ok).length} / ${rows.length}`);
console.log(allOk
  ? 'VERDICT: the runner is an ENFORCING GATE — control green, every class red-proofed.'
  : 'VERDICT: NOT a gate. Classes without a demonstrated red path: ' + rows.filter((r) => !r.ok).map((r) => r.cls).join(', '));
process.exitCode = allOk ? 0 : 1;
