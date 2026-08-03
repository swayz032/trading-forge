/**
 * SWALLOW RED-PROOF — can the landing detector catch a plant that was REQUESTED and then
 * SWALLOWED AT ITS CONSUMER? (R-605 §5.1)
 *
 * WHY THIS FILE EXISTS. `plant-landing.mjs`'s original red-proof disabled a plant the only way
 * a read-only `run.mjs` allowed: a knob NAME with no implementation. That tests "NEVER
 * REQUESTED". The failure mode that matters is "REQUESTED THEN SWALLOWED" — a DIFFERENT AXIS
 * (R-605 §8). The graded instrument swallowed three plants with one-token consumer edits and
 * the detector scored all three LANDED, printed `LANDING PROVEN`, and exited 0.
 *
 * ★ THE THREE MUTATIONS ARE THE GRADER'S OWN, REPRODUCED VERBATIM AND NOT RE-INVENTED —
 *   `A FIX IS PROVEN BY THE UNCHANGED CONVICTING INSTRUMENT`. If I had authored easier
 *   mutations I would be grading my own repair with an instrument I built to pass.
 *
 * ★ WHAT IS COMPARED, AND WHY BOTH DETECTORS RUN. For every mutant this file runs:
 *     PINNED   `plant-landing.mjs` exactly as it stands at the pin (the convicted version), and
 *     CANDIDATE `plant-landing.mjs` from the campaign tree (the repair).
 *   A repair is only demonstrated if the PINNED detector still says LANDED/exit 0 on the same
 *   tree where the CANDIDATE says REQUEST-ONLY/exit 1. `A CONTROL MUST DISCRIMINATE` — a
 *   candidate that reddened everything would be indistinguishable from a correct one without it.
 *
 * ★ run.mjs IS NOT TOUCHED, AND NEITHER IS THE CAMPAIGN TREE. Every mutation is applied to a
 *   copy materialised from the git object DB at the pin. The copy is verified by
 *   `git hash-object` against `git ls-tree`'s blob SHA — NOT by comparing it to the working
 *   tree, because R-600 §6 measured a `copy == working-tree` check PASSING on a mutated file.
 *
 * EXIT: 0 = every swallow was caught and named by the CANDIDATE, missed by the PINNED detector,
 *           and the companion healthy knob passed in the same run.
 *       1 = any of that failed, or the fixture could not be established.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const REL = 'prototypes/p0-vnext-admission';
const PIN = '3b9cc68e';

/** A knob that is untouched by every mutation below, carried in each population so a red
 *  verdict is proven to be DISCRIMINATION rather than a blanket failure. */
const COMPANION = 'fixture_invalid';

const MUTATIONS = [
  {
    knob: 'module_collection_add',
    file: 'module-collections.mjs',
    from: '    if (simulateAdd?.file === file) {',
    to: '    if (false && simulateAdd?.file === file) {',
  },
  {
    knob: 'module_collection_delete',
    file: 'module-collections.mjs',
    from: '      if (simulateDelete?.file === file && simulateDelete.collection === t) {',
    to: '      if (false && simulateDelete?.file === file && simulateDelete.collection === t) {',
  },
  {
    knob: 'emitted_module',
    file: 'module-tuple.mjs',
    from: "injectWrongContainer ? '.cts' : '.mts', outExt: injectWrongContainer ? '.cjs' : '.mjs'",
    to: "false ? '.cts' : '.mts', outExt: false ? '.cjs' : '.mjs'",
  },
  // ★★★ THE NEXT THREE ARE NOT THE GRADER'S — THEY CLOSE THE GRADER'S OWN OPEN `[HYPOTHESIS]`.
  // GRADE-PLANT-LANDING §"what I did not verify": *"run.mjs:589 live_collections — 3 knobs
  // (twin_pairs_delete, prereg_delete, new_unpinned_collection). The record at :589 precedes its
  // consumer checkAuxiliaryCollections at :594, so it is structurally swallowable in the same way
  // as F-1. I did NOT run that mutation. [HYPOTHESIS] — if confirmed, F-1's count rises from 3
  // to 6."* Each swallow below is one line in the CONSUMER (`membership.mjs:243`), targeted at
  // exactly the field that knob moves, so a swallow of one leaves the other two intact.
  {
    knob: 'twin_pairs_delete',
    file: 'membership.mjs',
    from: '    twin_missing: EXPECTED_TWIN_KEYS.filter((k) => !twinKeys.includes(k)),',
    to: '    twin_missing: [],',
  },
  {
    knob: 'prereg_delete',
    file: 'membership.mjs',
    from: '    prereg_missing: EXPECTED_PREREG_KEYS.filter((k) => !prereg.includes(k)),',
    to: '    prereg_missing: [],',
  },
  {
    knob: 'new_unpinned_collection',
    file: 'membership.mjs',
    from: '    collection_undeclared: names.filter((n) => !EXPECTED_COLLECTION_NAMES.includes(n)),',
    to: '    collection_undeclared: [],',
  },
];

const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let faults = [];
const note = (m) => { faults.push(m); };

console.log('='.repeat(110));
console.log('SWALLOW RED-PROOF — requested-then-swallowed, over isolated copies of the pin (R-605 §5.1)');
console.log('='.repeat(110));

// ── FIXTURE · MATERIALISE THE PIN AND PROVE IT IS THE PIN ─────────────────────────────────
// ⚠️ WHERE THE FIXTURE LIVES IS ITSELF A MEASURED RESULT — TWO WRONG ANSWERS CAME FIRST, AND
// BOTH PRESENTED AS "THE REPAIR FAILED" RATHER THAN AS A BROKEN HARNESS:
//   (1) a copy in the OS temp dir died with ERR_MODULE_NOT_FOUND, because `source-admission.mjs`
//       imports the bare specifier `typescript` and Node resolves that by walking PARENT
//       directories for `node_modules` — an out-of-repo copy has no such parent;
//   (2) with `node_modules` junctioned in, it then died on `fatal: not a git repository`,
//       because `module-collections.mjs:189` and `membership.mjs:64` run
//       `git show <commit>:<path>` with `cwd` set to their OWN directory.
// SO THE COPY MUST LIVE INSIDE THE REPO. `tmp/` is gitignored (asserted below), which keeps the
// fixture invisible to the advisor session's `git status` on this SHARED TREE, lets git resolve
// the pin, and lets `node_modules` resolve by walking up — with NO junction anywhere.
// ★ AND DROPPING THE JUNCTION REMOVES A REAL HAZARD, not just a step: a recursive delete
//   through a Windows junction deletes the TARGET, and that has already wiped this repo's
//   shared `node_modules` once.
const TMPROOT = path.join(REPO, 'tmp');
fs.mkdirSync(TMPROOT, { recursive: true });
const ignored = spawnSync('git', ['check-ignore', '-q', TMPROOT], { cwd: REPO }).status === 0;
console.log(`FIXTURE ROOT: ${path.relative(REPO, TMPROOT)}/ inside the repo; git-ignored=${ignored}`);
if (!ignored) {
  note(`${path.relative(REPO, TMPROOT)}/ is NOT git-ignored — the fixture would be visible to the `
    + 'advisor session on this shared tree; refusing to scatter untracked copies');
}
const TMP = fs.mkdtempSync(path.join(TMPROOT, 'p0vnext-swallow-'));
const PINDIR = path.join(TMP, 'pin');
fs.mkdirSync(PINDIR);

const cleanup = () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  const gone = !fs.existsSync(TMP);
  const nmIntact = fs.existsSync(path.join(REPO, 'node_modules', 'typescript', 'package.json'));
  console.log(`cleanup: fixture removed=${gone}  repo node_modules intact=${nmIntact}`);
  if (!nmIntact) {
    console.log('*** STOP CONDITION (swallow red-proof): the repo node_modules was damaged by this harness');
    process.exitCode = 1;
  }
};

// ⚠️ `-r` IS LOAD-BEARING AND WAS THE FIRST DEFECT IN THIS FILE: a non-recursive `ls-tree`
// returned 15 blobs and silently dropped the `surface/` SUBTREE (6 files) that run.mjs's
// admission pass reads. Every detector then failed in the copy for a reason that had nothing
// to do with the repair. The fixture is now proven by COUNT as well as by hash, because a
// missing file has no hash to mismatch — `AN ABSENCE HAS NO JOIN KEY UNLESS YOU COUNT`.
const tree = git(['ls-tree', '-r', PIN, `${REL}/`]).trim().split('\n').filter(Boolean);
const entries = tree.map((l) => {
  const [meta, file] = l.split('\t');
  const [, type, sha] = meta.split(/\s+/);
  return { type, sha, relPath: file.slice(`${REL}/`.length), rel: file };
}).filter((e) => e.type === 'blob');

const EXPECTED_BLOBS = 21;
if (entries.length !== EXPECTED_BLOBS) {
  note(`the pin holds ${entries.length} blobs under ${REL}, expected ${EXPECTED_BLOBS} — the fixture population changed`);
}
for (const e of entries) {
  const dest = path.join(PINDIR, e.relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // `buffer`, not `utf8`: a text round-trip could re-encode bytes and the hash check below is
  // the only thing standing between a silently re-encoded fixture and a false result.
  fs.writeFileSync(dest, execFileSync('git', ['cat-file', 'blob', e.sha], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 }));
}
let hashOk = 0;
for (const e of entries) {
  const got = git(['hash-object', path.join(PINDIR, e.relPath)]).trim();
  if (got === e.sha) hashOk += 1;
  else note(`materialised copy of ${e.relPath} does not hash to the pin (${got.slice(0, 12)} != ${e.sha.slice(0, 12)})`);
}
console.log(`FIXTURE: ${entries.length} blobs materialised from ${PIN}; git hash-object matches pin on ${hashOk}/${entries.length}`);
if (hashOk !== entries.length) note('the pinned fixture could not be established — nothing below is trustworthy');

// The candidate detector under test, taken from the campaign tree (this is the repair).
const CANDIDATE_SRC = fs.readFileSync(path.join(HERE, 'plant-landing.mjs'), 'utf8');
const PINNED_DETECTOR_SRC = fs.readFileSync(path.join(PINDIR, 'plant-landing.mjs'), 'utf8');
console.log(`DETECTORS: pinned=${PINNED_DETECTOR_SRC.length}B  candidate=${CANDIDATE_SRC.length}B  differ=${PINNED_DETECTOR_SRC !== CANDIDATE_SRC}`);
if (PINNED_DETECTOR_SRC === CANDIDATE_SRC) {
  note('the candidate detector is byte-identical to the pinned one — there is no repair under test');
}

function runDetector(dir, detectorFile, population) {
  const r = spawnSync(process.execPath, [path.join(dir, detectorFile), '--population', population],
    { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { exit: r.status, out: r.stdout ?? '' };
}

// ── PER-MUTATION ──────────────────────────────────────────────────────────────────────────
console.log('');
for (const m of MUTATIONS) {
  const dir = path.join(TMP, `mut-${m.knob}`);
  fs.cpSync(PINDIR, dir, { recursive: true });

  // Apply the swallow, and PROVE it applied — a mutation that silently missed would make every
  // assertion below pass for the wrong reason.
  const target = path.join(dir, m.file);
  const before = fs.readFileSync(target, 'utf8');
  const occurrences = before.split(m.from).length - 1;
  const after = before.split(m.from).join(m.to);
  fs.writeFileSync(target, after);
  const shaBefore = git(['hash-object', path.join(PINDIR, m.file)]).trim();
  const shaAfter = git(['hash-object', target]).trim();

  console.log(`── ${m.knob}  (swallow at ${m.file})`);
  console.log(`   mutation sites matched: ${occurrences}   file sha ${shaBefore.slice(0, 12)} -> ${shaAfter.slice(0, 12)}   changed=${shaBefore !== shaAfter}`);
  if (occurrences !== 1) note(`${m.knob}: expected exactly 1 mutation site in ${m.file}, found ${occurrences} — the fixture is not what it claims`);
  if (shaBefore === shaAfter) note(`${m.knob}: the mutated file is byte-identical to the pin — nothing was swallowed`);

  // Only the intended file may differ from the pin.
  const drifted = entries.filter((e) => e.relPath !== m.file)
    .filter((e) => git(['hash-object', path.join(dir, e.relPath)]).trim() !== e.sha)
    .map((e) => e.relPath);
  console.log(`   other files drifted from pin: ${drifted.length}${drifted.length ? ` (${drifted.join(', ')})` : ''}`);
  if (drifted.length) note(`${m.knob}: files other than ${m.file} differ from the pin: ${drifted.join(', ')}`);

  fs.writeFileSync(path.join(dir, 'plant-landing-CANDIDATE.mjs'), CANDIDATE_SRC);
  const population = `${m.knob},${COMPANION}`;

  const pinned = runDetector(dir, 'plant-landing.mjs', population);
  const cand = runDetector(dir, 'plant-landing-CANDIDATE.mjs', population);

  const pinnedSaysLanded = new RegExp(`^${m.knob}\\s+\\d+\\s+LANDED`, 'm').test(pinned.out);
  const candNamesIt = new RegExp(`PLANT REQUESTED BUT SWALLOWED: '${m.knob}'`).test(cand.out);
  const candFaultsCompanion = new RegExp(`(SWALLOWED|NOT PROVEN TO LAND): '${COMPANION}'`).test(cand.out);
  const candCompanionLanded = new RegExp(`^${COMPANION}\\s+\\d+\\s+LANDED`, 'm').test(cand.out);

  console.log(`   PINNED    detector: exit=${pinned.exit}  scores '${m.knob}' LANDED: ${pinnedSaysLanded}   <- the conviction, reproduced`);
  console.log(`   CANDIDATE detector: exit=${cand.exit}  names '${m.knob}' as SWALLOWED: ${candNamesIt}`);
  console.log(`   CANDIDATE on companion '${COMPANION}' in the SAME run: LANDED=${candCompanionLanded} faulted=${candFaultsCompanion}`);

  if (pinned.exit !== 0 || !pinnedSaysLanded) {
    note(`${m.knob}: the PINNED detector did NOT reproduce the false green (exit=${pinned.exit}, landed=${pinnedSaysLanded}) — `
      + 'the fixture does not reproduce the graded defect, so a green candidate proves nothing');
  }
  if (cand.exit !== 1) note(`${m.knob}: the CANDIDATE detector exited ${cand.exit}, not 1 — the guard does not fail the command`);
  if (!candNamesIt) note(`${m.knob}: the CANDIDATE detector did not NAME the swallowed knob`);
  if (candFaultsCompanion || !candCompanionLanded) {
    note(`${m.knob}: the CANDIDATE faulted the healthy companion '${COMPANION}' — the red is not discrimination`);
  }
  console.log('');
}

// ── CONTROL · THE CANDIDATE MUST BE GREEN ON THE UNMUTATED PIN ────────────────────────────
// Without this, "the candidate goes red on a swallow" is satisfied by a candidate that is
// always red. This is the positive control for the whole file.
const controlPop = `${MUTATIONS.map((m) => m.knob).join(',')},${COMPANION}`;
fs.writeFileSync(path.join(PINDIR, 'plant-landing-CANDIDATE.mjs'), CANDIDATE_SRC);
const controlRun = runDetector(PINDIR, 'plant-landing-CANDIDATE.mjs', controlPop);
const controlClean = !/PLANT (REQUESTED BUT SWALLOWED|NOT PROVEN TO LAND)/.test(controlRun.out);
console.log(`CONTROL — CANDIDATE on the UNMUTATED pin [${controlPop}]: exit=${controlRun.exit} no-faults=${controlClean}`);
if (controlRun.exit !== 0 || !controlClean) {
  note(`the CANDIDATE is not green on the unmutated pin (exit=${controlRun.exit}) — its red verdicts are not attributable to the swallows`);
}

cleanup();

console.log('');
if (faults.length) {
  for (const f of faults) console.log(`*** STOP CONDITION (swallow red-proof): ${f}`);
  process.exitCode = 1;
} else {
  console.log(`SWALLOW RED-PROOF PASSED: ${MUTATIONS.length}/${MUTATIONS.length} requested-but-swallowed plants were`);
  console.log('scored LANDED by the pinned detector and REQUEST-ONLY (named, exit 1) by the candidate,');
  console.log(`while '${COMPANION}' passed in every one of those same runs and the candidate is green on the pin.`);
  process.exitCode = 0;
}
