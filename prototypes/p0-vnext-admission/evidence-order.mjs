/**
 * 4d-ii INSTRUMENT — "terminal acceptance failure exits non-zero AFTER EVIDENCE COLLECTION"
 *
 * ⚠️ THIS FIXTURE DELIBERATELY DOES NOT RULE. R-596 §3 leaves the reading of
 * "after evidence collection" OPEN and PROVISIONAL, and `AN INSTRUMENT THAT PICKS AN
 * INTERPRETATION RULES ON IT` (R-596 §8). So this scores TWO INDEPENDENT COLUMNS and
 * selects neither:
 *
 *   (i)  OWN_FINDING — the terminating run printed ITS OWN finding before exiting.
 *                      This is reading (B)'s verdict column.
 *   (ii) FULL_BODY   — the terminating run printed the FULL evidence body before exiting.
 *                      This is reading (A)'s verdict column.
 *
 * The desk reads its answer off whichever column its later ruling selects. Because both
 * columns are emitted for every class, that ruling is auditable against data that
 * PREDATES it.
 *
 * EXIT SEMANTICS — and this is the load-bearing design decision:
 *   exit 0 = the MEASUREMENT succeeded (every class scored on both columns, no UNKNOWN
 *            cell, and the RED witness scored 0/0).
 *   exit 1 = the INSTRUMENT could not measure.
 * It is NOT non-zero because column (ii) has reds. Exiting on a red column would enact
 * reading (A) in code, which is the precise thing this fixture exists to avoid.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');

// ---- THE POPULATION IS DERIVED FROM run.mjs, NEVER HAND-COPIED ---------------------------
// A hand-copied list of 25 names is a fabricated safety claim: it would keep passing after
// run.mjs gained or lost a class. The names come out of the file that declares them.
function declaredInjectionKnobs() {
  const src = fs.readFileSync(RUN, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/INJECT === '([a-z_]+)'/g)) names.add(m[1]);
  return [...names].sort();
}

// ---- THE TWO COLUMNS, AS PREDICATES OVER STDOUT ------------------------------------------
// Both are STRUCTURAL (named sections the body emits), never a line count. A line-count
// threshold would be a proxy, and a proxy silently re-scopes the moment the body changes
// length for an unrelated reason.
const BODY_MARKERS = ['PINNED SURFACE:', 'SEPARABILITY:', 'NEGATIVE CONTROL:'];
const FINDING_RE = /^\s*\*\*\* /m;

const scoreOwnFinding = (out) => FINDING_RE.test(out);
const scoreFullBody = (out) => BODY_MARKERS.every((m) => out.includes(m));

function runInjection(inj) {
  const r = spawnSync(process.execPath, [RUN], {
    cwd: HERE,
    env: { ...process.env, PROTO_INJECT: inj },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { failed: String(r.error.message) };
  return {
    exit: r.status,
    out: r.stdout ?? '',
    errBytes: Buffer.byteLength(r.stderr ?? ''),
    lines: (r.stdout ?? '').split('\n').length - 1,
  };
}

// ---- THE RED WITNESS -----------------------------------------------------------------------
// R-596 §4 requires the RED path DEMONSTRATED, not asserted. The INSTRUMENT FAULT throw class
// is the witness: it terminates non-zero emitting ZERO stdout, so it scores 0 on BOTH columns.
// Raised by calling the real assertion with disagreeing arguments — no file is edited and no
// pin is moved, so this witness costs the object nothing.
function redWitness() {
  const src = "import('./module-collections.mjs').then(m=>{"
    + "m.assertParserAgreesWithRuntime('export const FOO = [1];', ['BAR']);"
    + "process.exit(0);}).catch(e=>{console.error(e.message);process.exit(1);});";
  const r = spawnSync(process.execPath, ['-e', src], { cwd: HERE, encoding: 'utf8' });
  const out = r.stdout ?? '';
  return {
    exit: r.status,
    out,
    threw: /INSTRUMENT FAULT/.test(r.stderr ?? ''),
    ownFinding: scoreOwnFinding(out),
    fullBody: scoreFullBody(out),
    lines: out.split('\n').length - 1,
  };
}

// ---- MEASURE ------------------------------------------------------------------------------
const knobs = declaredInjectionKnobs();
console.log('='.repeat(112));
console.log('4d-ii EVIDENCE-ORDER INSTRUMENT — TWO COLUMNS, READING-NEUTRAL (R-596 §4)');
console.log(`declared injection knobs parsed from run.mjs: ${knobs.length}`);
console.log('='.repeat(112));

const control = runInjection('');
console.log(`CONTROL (no injection): exit=${control.exit} lines=${control.lines} stderr_bytes=${control.errBytes}`);
if (control.exit !== 0) {
  console.log('*** INSTRUMENT FAULT: the clean control did not exit 0 — nothing measured here means anything');
  process.exit(1);
}
console.log('');
console.log('knob                          exit  lines   (i) OWN_FINDING   (ii) FULL_BODY');
console.log('-'.repeat(112));

const rows = [];
for (const knob of knobs) {
  const r = runInjection(knob);
  if (r.failed) {
    console.log(`${knob.padEnd(28)}  SPAWN FAILED: ${r.failed}`);
    rows.push({ knob, unknown: true });
    continue;
  }
  const row = {
    knob,
    exit: r.exit,
    lines: r.lines,
    ownFinding: scoreOwnFinding(r.out),
    fullBody: scoreFullBody(r.out),
    errBytes: r.errBytes,
  };
  rows.push(row);
  console.log(
    `${knob.padEnd(28)}  ${String(row.exit).padEnd(4)} ${String(row.lines).padStart(5)}   `
    + `${(row.ownFinding ? 'YES' : 'NO').padEnd(15)}   ${row.fullBody ? 'YES' : 'NO'}`,
  );
}

// ---- THE RED WITNESS, RUN AND SHOWN --------------------------------------------------------
const red = redWitness();
console.log('-'.repeat(112));
console.log(
  `${'<INSTRUMENT FAULT throw>'.padEnd(28)}  ${String(red.exit).padEnd(4)} ${String(red.lines).padStart(5)}   `
  + `${(red.ownFinding ? 'YES' : 'NO').padEnd(15)}   ${red.fullBody ? 'YES' : 'NO'}   <- RED WITNESS`,
);

// ---- SUMMARY, BOTH COLUMNS, NEITHER SELECTED -----------------------------------------------
const scored = rows.filter((r) => !r.unknown);
const unknown = rows.filter((r) => r.unknown);
const colI = scored.filter((r) => r.ownFinding).length;
const colII = scored.filter((r) => r.fullBody).length;
const nonZero = scored.filter((r) => r.exit !== 0).length;

console.log('');
// ⚠️ POPULATION CAPTION (R-596 §2): these are INJECTION KNOBS, not declared FAILURE_CLASSES.
// The join is NOT 1:1 — `module_collection_add` and `_delete` are two knobs that both fire the
// single declared class `collection_shape`. Counting knobs and calling them classes is exactly
// the join error this desk corrected, so the denominator is named for what it counts.
console.log(`POPULATION: ${scored.length} injection KNOBS (not classes; the knob->class join is not 1:1)`);
console.log(`4d-i   terminal failure exits non-zero      : ${nonZero}/${scored.length}`);
console.log(`4d-ii  COLUMN (i)  own finding printed      : ${colI}/${scored.length}   <- reading (B)'s verdict`);
console.log(`4d-ii  COLUMN (ii) full evidence body       : ${colII}/${scored.length}   <- reading (A)'s verdict`);
console.log(`       cells UNKNOWN                        : ${unknown.length}`);
console.log('');
console.log('DIVERGENT ROWS (the two columns disagree — these ARE the reading question):');
const divergent = scored.filter((r) => r.ownFinding !== r.fullBody);
if (divergent.length === 0) console.log('  <none>');
for (const r of divergent) {
  console.log(`  ${r.knob}: own_finding=${r.ownFinding} full_body=${r.fullBody} lines=${r.lines} exit=${r.exit}`);
}
console.log('');
console.log('*** THIS FIXTURE RULES ON NEITHER READING. R-596 §3 holds the choice open. ***');

// ---- THE INSTRUMENT'S OWN SELF-CHECK -------------------------------------------------------
// Fails ONLY on a measurement defect — never on which column is red.
const faults = [];
if (unknown.length) faults.push(`${unknown.length} class(es) could not be scored`);
if (!red.threw) faults.push('the RED witness did not raise an INSTRUMENT FAULT — the red path is asserted, not demonstrated');
if (red.ownFinding || red.fullBody) faults.push('the RED witness scored non-zero on a column — it cannot serve as the 0/0 witness');
if (scored.length === 0) faults.push('no classes were scored at all');

if (faults.length) {
  console.log('');
  for (const f of faults) console.log(`*** STOP CONDITION (4d-ii instrument): ${f}`);
  process.exitCode = 1;
} else {
  console.log(`MEASUREMENT COMPLETE: ${scored.length} knobs scored on both columns; `
    + `RED witness demonstrated at 0/0 (exit=${red.exit}, stdout lines=${red.lines}).`);
  process.exitCode = 0;
}
