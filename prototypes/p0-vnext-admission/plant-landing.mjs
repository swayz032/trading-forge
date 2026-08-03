/**
 * DID THE PLANT LAND? — a per-knob landing witness over the pinned 37 (R-602 §4.1)
 *
 * THE DEFECT THIS EXISTS FOR: run.mjs's own law is that "AN INJECTION THAT DID NOT LAND
 * PRODUCES A GREEN INDISTINGUISHABLE FROM A GUARD THAT DID NOT FIRE." All 37 knobs exit 1,
 * but an exit code says nothing about WHY. A knob whose plant silently no-opped would exit 1
 * for an unrelated reason and be scored as a pass — which is the load-bearing gap in 4d-i.
 *
 * ⚠️ `PLANT_WITNESS` DOES NOT COVER THIS. [MEASURED] run.mjs has four PLANT_WITNESS sites:
 * :348 declares, :673 prints, and the only pushes are :398 and :413 — both inside the 34(d-u)
 * anchor work. COVERAGE IS 2 OF 37. R-602 §4.1 graded its own sufficiency claim a HYPOTHESIS;
 * it is refuted, so this instrument supplies the enumeration that ruling asked for instead.
 *
 * THE UNIVERSAL CHANNEL, AND WHY IT REACHES EVEN THE TRUNCATED ROWS: run.mjs:95-103 emits
 * `EFFECT-DIGEST` from a `process.on('exit')` hook, deliberately, "because the collection gate
 * below EXITS EARLY … a fingerprint missing exactly when a class fires would be blind to the
 * classes that matter most." [MEASURED] the 5-line module_collection_add run still prints one.
 *
 * ★ WHAT THIS INSTRUMENT MAY AND MAY NOT CONCLUDE:
 *   A digest that DIFFERS from the control is attributable to the injection — the env var is
 *   the only thing that changed between the two runs, and C0 establishes the control is
 *   reproducible. That is a LANDING.
 *   A digest EQUAL to the control's is NOT a not-landing. It is consistent with "the plant did
 *   not apply" AND with "the plant applied but recorded no effect before exit". Those are not
 *   separated here, so such a row is reported UNPROVABLE and never collapsed into NOT LANDED.
 *   `AN ABSENCE THAT BOTH HYPOTHESES PREDICT IS NOT EVIDENCE` (R-599 §10).
 *
 * ★ run.mjs IS READ-ONLY HERE. No witness was added to it (R-602 §4.1 forbids it). The
 *   red-proof disables a plant the only way available without editing the object: a knob NAME
 *   with no implementation. Nothing is written to disk by this file.
 *
 * EXIT: 0 = every pinned knob is proven to land AND every disabled plant was caught.
 *       1 = a pinned knob could not be proven to land, or the instrument could not measure.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PINNED_KNOBS } from './evidence-order.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, 'run.mjs');

const DIGEST_RE = /^EFFECT-DIGEST: ([0-9a-f]{64})$/m;
const WITNESS_RE = /^PLANT LANDED \(positive control\): /m;

function run(inject) {
  const r = spawnSync(process.execPath, [RUN], {
    cwd: HERE,
    env: { ...process.env, PROTO_INJECT: inject },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = r.stdout ?? '';
  return {
    exit: r.status,
    out,
    digest: (out.match(DIGEST_RE) ?? [])[1] ?? null,
    witness: WITNESS_RE.test(out),
    errBytes: Buffer.byteLength(r.stderr ?? ''),
  };
}

/** Strip the two lines that differ by construction, so a diff means a BEHAVIOURAL difference. */
const normalize = (out) => out
  .split('\n')
  .filter((l) => !l.startsWith('INJECTION:') && !l.startsWith('EFFECT-DIGEST:'))
  .join('\n');

let faults = [];
const note = (m) => { faults.push(m); };

console.log('='.repeat(110));
console.log('PLANT-LANDING WITNESS — per-knob, over the pinned 37 (R-602 §4.1)');
console.log('='.repeat(110));

// ── C0 · IS THE DIGEST AN INSTRUMENT AT ALL? ──────────────────────────────────────────────
// Comparing digests is meaningless if the control's own digest wanders. Three runs, not two:
// one repeat proves nothing about stability. ⚠️ This is EVIDENCE of determinism, not PROOF —
// R-600 §10 leaves genuine harness nondeterminism open and I am not closing it here.
const controls = [run(''), run(''), run('')];
const controlDigests = [...new Set(controls.map((c) => c.digest))];
console.log(`C0 control x3 : digests=${controlDigests.length} distinct  exit=${controls.map((c) => c.exit).join(',')}  `
  + `stderr_bytes=${controls.map((c) => c.errBytes).join(',')}`);
if (controlDigests.length !== 1 || !controlDigests[0]) {
  note('the control digest is not reproducible across 3 runs — digest comparison is not an instrument');
}
const CONTROL = controls[0];
console.log(`C0 control digest: ${CONTROL.digest}`);
console.log(`C0 control exit=${CONTROL.exit} (a clean control must exit 0)`);
if (CONTROL.exit !== 0) note('the clean control did not exit 0');

// ── THE PER-KNOB TABLE ────────────────────────────────────────────────────────────────────
function classify(r) {
  if (r.digest === null) return { verdict: 'UNMEASURED', how: 'no EFFECT-DIGEST emitted' };
  if (r.witness) return { verdict: 'LANDED', how: 'PLANT_WITNESS' };
  if (r.digest !== CONTROL.digest) return { verdict: 'LANDED', how: 'digest≠control' };
  if (normalize(r.out) !== normalize(CONTROL.out)) return { verdict: 'LANDED', how: 'stdout≠control' };
  return { verdict: 'UNPROVABLE', how: 'digest==control and stdout==control' };
}

/**
 * The guard, in one place so the red-proof cannot exercise a different rule than the run does.
 * A pinned knob that cannot be proven to land is a STOP: it is the exact state in which an
 * exit code is scored as a pass while nothing was actually injected. NAMED, never counted.
 */
function faultsFor(rs) {
  return rs
    .filter((r) => r.verdict !== 'LANDED')
    .map((r) => `PLANT NOT PROVEN TO LAND: '${r.knob}' — ${r.how}; its exit code cannot be `
      + 'credited to an injection');
}

// `--population a,b,c` exists ONLY so the red-proof can spawn this file over a doctored
// population and observe its PROCESS EXIT CODE. It is an explicit argv mode, never an env
// switch, so it cannot silently redirect a real measurement.
const popArg = process.argv.indexOf('--population');
const POPULATION = popArg === -1 ? PINNED_KNOBS : process.argv[popArg + 1].split(',');
if (popArg !== -1) console.log(`⚠️ POPULATION OVERRIDDEN (red-proof mode): ${POPULATION.join(', ')}`);

console.log('');
console.log('knob                          exit  verdict      how                  digest(12)');
console.log('-'.repeat(110));

const rows = [];
for (const knob of POPULATION) {
  const r = run(knob);
  const c = classify(r);
  rows.push({ knob, ...r, ...c });
  console.log(`${knob.padEnd(28)}  ${String(r.exit).padEnd(4)}  ${c.verdict.padEnd(11)}  ${c.how.padEnd(19)}  `
    + `${(r.digest ?? '<none>').slice(0, 12)}`);
}

// ── PAIRWISE DISTINCTNESS ─────────────────────────────────────────────────────────────────
// run.mjs:99-101 calls the ledger "deterministic per injection, which is all pairwise-
// distinctness needs" — so distinctness is a DESIGNED property and worth measuring against.
// ⚠️ A collision is NOT automatically a defect: two knobs may legitimately record the same
// effects. It is reported, not failed.
const byDigest = new Map();
for (const r of rows) {
  if (!r.digest) continue;
  if (!byDigest.has(r.digest)) byDigest.set(r.digest, []);
  byDigest.get(r.digest).push(r.knob);
}
const collisions = [...byDigest.entries()].filter(([, ks]) => ks.length > 1);
const sharesControl = rows.filter((r) => r.digest === CONTROL.digest).map((r) => r.knob);

console.log('-'.repeat(110));
console.log(`distinct digests across the ${rows.length}: ${byDigest.size}`);
console.log(`digest collisions between knobs: ${collisions.length}`);
for (const [d, ks] of collisions) console.log(`  ${d.slice(0, 12)} shared by: ${ks.join(', ')}`);
console.log(`knobs sharing the CONTROL digest: ${sharesControl.length}${sharesControl.length ? ` (${sharesControl.join(', ')})` : ''}`);

// ── THE RED-PROOF: A DISABLED PLANT MUST BE CAUGHT AND NAMED ──────────────────────────────
// run.mjs is read-only, so a plant is disabled the only way left: a knob NAME with no
// implementation. Nothing in run.mjs matches it, so no plant applies — exactly the state a
// silently-no-opping knob would be in.
console.log('');
console.log('RED-PROOF — disabled plants (knob names with no implementation in run.mjs):');
const disabled = ['partition_overlap_DISABLED', 'twin_DISABLED', 'zzz_no_such_knob_at_all'];
const disabledRows = disabled.map((name) => {
  const r = run(name);
  const c = classify(r);
  console.log(`  ${name.padEnd(28)} exit=${String(r.exit).padEnd(3)} ${c.verdict.padEnd(11)} ${c.how}`);
  return { knob: name, ...c };
});
const caughtDisabled = disabledRows.filter((r) => r.verdict !== 'LANDED');
console.log(`  => ${caughtDisabled.length}/${disabled.length} disabled plants correctly NOT scored LANDED`
  + `${caughtDisabled.length ? `: ${caughtDisabled.map((r) => r.knob).join(', ')}` : ''}`);
if (caughtDisabled.length !== disabled.length) {
  note(`a DISABLED plant was scored LANDED — the detector cannot tell a landing from a no-op: `
    + disabledRows.filter((r) => r.verdict === 'LANDED').map((r) => r.knob).join(', '));
}

// ── SUMMARY ───────────────────────────────────────────────────────────────────────────────
const landed = rows.filter((r) => r.verdict === 'LANDED');
const unprovable = rows.filter((r) => r.verdict === 'UNPROVABLE');
const unmeasured = rows.filter((r) => r.verdict === 'UNMEASURED');
const byHow = landed.reduce((a, r) => (a[r.how] = (a[r.how] ?? 0) + 1, a), {});

console.log('');
console.log('='.repeat(110));
console.log(`POPULATION: ${POPULATION.length} pinned knobs`);
console.log(`LANDED     : ${landed.length}/${POPULATION.length}  ${JSON.stringify(byHow)}`);
console.log(`UNPROVABLE : ${unprovable.length}${unprovable.length ? ` (${unprovable.map((r) => r.knob).join(', ')})` : ''}`);
console.log(`UNMEASURED : ${unmeasured.length}${unmeasured.length ? ` (${unmeasured.map((r) => r.knob).join(', ')})` : ''}`);
console.log(`PLANT_WITNESS coverage: ${rows.filter((r) => r.witness).length}/${POPULATION.length}`
  + ` (${rows.filter((r) => r.witness).map((r) => r.knob).join(', ') || 'none'})`);

for (const f of faultsFor(rows)) note(f);

// ── RED-PROOF STAGE 2 · THE GUARD MUST GO RED, AT PROCESS LEVEL, AND NAME THE KNOB ────────
// Stage 1 above proved the CLASSIFIER calls a disabled plant UNPROVABLE. That is not the same
// claim as "the guard fails the command" — `AN ASSERT THAT CANNOT FAIL THE COMMAND IS A
// PRINTOUT`. This spawns THIS FILE over a doctored population and reads its exit code.
// Skipped in --population mode so the red-proof cannot recurse into itself.
if (popArg === -1) {
  console.log('');
  console.log('RED-PROOF STAGE 2 — the guard at process level:');
  const doctored = [PINNED_KNOBS[0], PINNED_KNOBS[1], 'twin_DISABLED'].join(',');
  const self = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--population', doctored],
    { cwd: HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const namesIt = /PLANT NOT PROVEN TO LAND: 'twin_DISABLED'/.test(self.stdout ?? '');
  const cleanRows = /PLANT NOT PROVEN TO LAND: '(?!twin_DISABLED)/.test(self.stdout ?? '');
  console.log(`  doctored population [${doctored}] -> exit=${self.status}`);
  console.log(`  names the disabled knob: ${namesIt}`);
  console.log(`  the two real knobs in that population still pass: ${!cleanRows}`);
  if (self.status !== 1) note(`RED-PROOF FAILED: a population containing a disabled plant exited ${self.status}, not 1`);
  if (!namesIt) note('RED-PROOF FAILED: the guard did not NAME the disabled knob');
  if (cleanRows) note('RED-PROOF FAILED: the guard faulted a knob that does land — it is not discriminating');
}

console.log('');
if (faults.length) {
  for (const f of faults) console.log(`*** STOP CONDITION (plant landing): ${f}`);
  process.exitCode = 1;
} else {
  console.log(`LANDING PROVEN: all ${POPULATION.length} pinned plants land, each attributable to its own`);
  console.log(`injection against a control reproducible across 3 runs; all ${disabled.length} disabled plants caught.`);
  process.exitCode = 0;
}
