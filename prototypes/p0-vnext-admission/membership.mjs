// ITEM 15 (R-548 §4) — EXPECTED MEMBERSHIP IS INDEPENDENT OF THE CORPUS UNDER TEST.
//
// THE DEFECT THIS CLOSES, at the executable line it lived on:
//   corpus.mjs:291  export const ORIGINAL_52_IDS = CORPUS.map((c) => c.id).filter(...)
// The "frozen" population was COMPUTED FROM THE MUTABLE POPULATION IT EXISTS TO CONSTRAIN.
// R-548 §2's attack B renamed 35(a) -> 35(z) with the body and the expectation byte-untouched;
// `missing_ids` came back `[]` and the gate exited 0, because the set was asking itself whether
// its own members exist.
//   A SET THAT AUTHORS ITS OWN EXPECTED MEMBERSHIP WILL ALWAYS AGREE WITH ITS RENAMES.
//
// THE REPLACEMENT: the expected 52 are read from a PINNED PRIOR ARTIFACT — the AR-589 corpus
// exactly as committed at 8297ebbe — through `git show`, and are NEVER derived from the corpus
// under test under this or any other name (R-555 §5: "the defect is SELF-AUTHORSHIP, not the
// identifier"). A hand-copied id list would be the same fabrication in a different costume:
// it would prove the transcription, not the artifact.
//
// ⚠️ THE MEMBERSHIP IS READ BY EXECUTING THE PINNED MODULE, NOT BY GREPPING IT. A grep for
// `id: '` over the baseline source returns 63 — it matches the `id` fields of the runtime
// fixtures nested INSIDE the rows, and the GREEN rows. That number is wrong and it is the kind
// of wrong that reads as authoritative. The module is imported and `CORPUS.map` is taken on the
// FROZEN blob, where it is a READ of a pinned artifact rather than a self-authored expectation.
//
// ⚠️ DECLARED SUBSTITUTION (a proxy-for-production must declare its substitution): the baseline
// module's two RELATIVE import specifiers are rewritten to absolute file URLs so it can be
// imported from a temp directory. The rewrite is exactly those two lines and the count is
// printed as its own witness. No fixture byte and no id is touched.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_COMMIT = '8297ebbe';
export const BASELINE_REPO_PATH = 'prototypes/p0-vnext-admission/corpus.mjs';

// 🛑 R-558 §3 — THE SECOND PIN, AND THE LAW THIS FILE FAILED TO SWEEP.
// Item 15 pinned the ORIGINAL 52 externally and left the EXPANDED corpus's membership in
// `DECLARED_ADDITIONS`: a mutable array, in this file, in the same delivery it polices.
//   THAT WAS `CORPUS.map(` WEARING A DIFFERENT NAME.
// An external read constructed the consequence and the desk reproduced it: DELETING GUARD ROW
// `56(a)` — the row that exists because the accuracy-validator's `F-1` CRITICAL admitted a module
// that reached the ledger — left `GATE: PASS`, `EXIT 0`. `declared_but_absent` was computed,
// printed, and gated nothing.
// ⚠️ AND ADDING THAT FIELD TO THE FAILURE CLASSES WOULD BE `ONE LEVEL SHORT`: it catches deleting
// the ROW while leaving its DECLARATION, and NOT the coordinated deletion of both — because the
// declaration was editable in the same commit.
// THE FIX IS THE SAME MECHANISM ITEM 15 ALREADY PROVED: pin the expanded identities to a FROZEN
// COMMIT. A later commit cannot edit `53e80935`. Legitimate growth must BUMP THE PIN, which is a
// deliberate, reviewable act in git history — not an array edit that reviews itself.
export const EXPANDED_PIN_COMMIT = '53e80935';

export function loadPinnedCorpus(commit) {
  const raw = execFileSync('git', ['show', `${commit}:${BASELINE_REPO_PATH}`], { cwd: HERE, encoding: 'utf8' });
  const blob = execFileSync('git', ['rev-parse', `${commit}:${BASELINE_REPO_PATH}`], { cwd: HERE, encoding: 'utf8' }).trim();
  const abs = (n) => JSON.stringify(pathToFileURL(path.join(HERE, n)).href);
  let subs = 0;
  const patched = raw.replace(/from '\.\/(source-admission|runtime-admission)\.mjs'/g, (_m, n) => { subs += 1; return `from ${abs(`${n}.mjs`)}`; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0vnext-baseline-'));
  const f = path.join(dir, 'baseline-corpus.mjs');
  fs.writeFileSync(f, patched);
  return { file: f, substitutions: subs, rawBytes: raw.length, blob };
}

/** The AR-589 baseline, kept as a named alias because `emitted-freeze.mjs` consumes it. */
export function loadBaselineCorpus() { return loadPinnedCorpus(BASELINE_COMMIT); }

// The ONE historical identity change between AR-589's corpus and this one. It is declared here
// because item 15 names it explicitly: AR-589's row `54` was the module-scope `this` STATEMENT,
// which now lives at `54(c)`. The CURRENT row `54` is the container twin — a DIFFERENT OBJECT
// that was never in AR-589's 52 and must NOT be scored as if it were.
export const HISTORICAL_RENAMES = Object.freeze({ '54': '54(c)' });

// 🛑 R-558: `DECLARED_ADDITIONS` IS DELETED. It read:
//     export const DECLARED_ADDITIONS = Object.freeze(['34(d-u)','54',...,'56(a)',...,'57']);
// and it was the self-authorship item 15 closed for the 52 and left open for everything else.
// The additions are now DERIVED FROM TWO FROZEN PINS (expanded minus original), so no mutable
// array decides which rows are allowed to exist, and there is nothing to edit in a coordinated
// deletion. ✅ THE COORDINATED CASE IS CLOSED BY CONSTRUCTION, NOT BY A SECOND CHECK.

const { file, substitutions, rawBytes, blob } = loadBaselineCorpus();
const baseline = await import(pathToFileURL(file).href);

export const BASELINE_META = Object.freeze({ commit: BASELINE_COMMIT, blob, rawBytes, substitutions });

// ⚠️★★★★★ READ THIS BEFORE FLAGGING THE NEXT LINE. A grep for `CORPUS.map(` HITS HERE, and it
// is NOT item 15's defect. R-555 §5 states the test exactly: "the defect is SELF-AUTHORSHIP, not
// the identifier." `baseline.CORPUS` is the FROZEN 8297ebbe blob, a different object from the
// mutable `CORPUS` under test — renaming a row today cannot change it, which is the whole point.
// THE DISCRIMINATOR IS EXECUTED, NOT ARGUED: red-proof (b) renames 35(a) -> 35(z) in the live
// corpus and this set still expects `35(a)` and reports it MISSING. A self-authored set cannot
// do that; that is precisely what it failed to do under attack B.
const baselineIds = baseline.CORPUS.map((c) => c.id);
/** The expected original 52, read from the pinned artifact and mapped through the declared renames. */
export const EXPECTED_ORIGINAL_IDS = Object.freeze(baselineIds.map((id) => HISTORICAL_RENAMES[id] ?? id));
/** Baseline rows are the ONLY source of the expected per-kind counts item 16 asserts against. */
export const EXPECTED_SOURCE_IDS = Object.freeze(
  baseline.CORPUS.filter((c) => c.kind === 'source').map((c) => HISTORICAL_RENAMES[c.id] ?? c.id),
);
export const BASELINE_BY_ID = new Map(
  [...baseline.CORPUS, ...baseline.GREEN].map((c) => [HISTORICAL_RENAMES[c.id] ?? c.id, c]),
);

// ---- THE EXPECTATION AUDITS ITSELF BEFORE IT IS USED -----------------------------------
// Cardinality AND uniqueness, on the EXPECTED set, asserted at load. If the pinned artifact
// cannot yield exactly 52 unique ids then the instrument is broken and no verdict computed
// from it means anything — so this throws rather than returning a number nobody checked.
const expectedDupes = EXPECTED_ORIGINAL_IDS.filter((id, i) => EXPECTED_ORIGINAL_IDS.indexOf(id) !== i);
if (expectedDupes.length) {
  throw new Error(`INSTRUMENT FAULT: pinned baseline ${BASELINE_COMMIT} yields duplicate ids: ${[...new Set(expectedDupes)].join(', ')}`);
}
export const EXPECTED_CARDINALITY = 52;
if (EXPECTED_ORIGINAL_IDS.length !== EXPECTED_CARDINALITY) {
  throw new Error(`INSTRUMENT FAULT: pinned baseline ${BASELINE_COMMIT} yields ${EXPECTED_ORIGINAL_IDS.length} ids, expected ${EXPECTED_CARDINALITY}`);
}

// ---- R-558: THE EXPANDED PIN, AUDITED THE SAME WAY THE 52's PIN IS -----------------------
const expandedPin = loadPinnedCorpus(EXPANDED_PIN_COMMIT);
const expandedBaseline = await import(pathToFileURL(expandedPin.file).href);
export const EXPANDED_META = Object.freeze({ commit: EXPANDED_PIN_COMMIT, blob: expandedPin.blob, rawBytes: expandedPin.rawBytes });
export const EXPECTED_EXPANDED_IDS = Object.freeze(expandedBaseline.CORPUS.map((c) => c.id));
const EXPECTED_EXPANDED_SET = new Set(EXPECTED_EXPANDED_IDS);
const expandedDupes = EXPECTED_EXPANDED_IDS.filter((id, i) => EXPECTED_EXPANDED_IDS.indexOf(id) !== i);
if (expandedDupes.length) {
  throw new Error(`INSTRUMENT FAULT: expanded pin ${EXPANDED_PIN_COMMIT} yields duplicate ids: ${[...new Set(expandedDupes)].join(', ')}`);
}
// The expanded set MUST contain the pinned 52. If it does not, the two pins disagree about the
// campaign's own history and no membership verdict computed from them means anything.
const notInExpanded = EXPECTED_ORIGINAL_IDS.filter((id) => !EXPECTED_EXPANDED_SET.has(id));
if (notInExpanded.length) {
  throw new Error(`INSTRUMENT FAULT: pins disagree — ${BASELINE_COMMIT} expects ids absent from ${EXPANDED_PIN_COMMIT}: ${notInExpanded.join(', ')}`);
}
/** Additions DERIVED from two frozen pins, replacing the hand-maintained DECLARED_ADDITIONS. */
export const DERIVED_ADDITIONS = Object.freeze(EXPECTED_EXPANDED_IDS.filter((id) => !EXPECTED_ORIGINAL_IDS.includes(id)));

// 🛑 R-561 — THE **GREEN** POPULATION WAS STILL UNPINNED, ONE ARRAY BESIDE THE RED ONE.
// FOURTH SWEEP FAILURE OF THE SAME LAW: item 15 pinned the red 52 · R-558 found the expanded red
// set unpinned · and the GREEN set sat unpinned the whole time. `run.mjs` asserted only
// `green_admitted === green_total` — BOTH OPERANDS COMPUTED FROM THE SAME MUTABLE ARRAY. Deleting
// `G-src-implements-erased` gave `7 / 7`, `GATE: PASS`, `EXIT 0`: the count simply followed the
// array down.
//   A MUTABLE POPULATION CANNOT CERTIFY ITS OWN COMPLETE MEMBERSHIP BY COUNTING ONLY ITS
//   SURVIVING MEMBERS.
// 🛑 THE STAKES ARE NOT ABSTRACT: `G-src-implements-erased` and `G-src-interface-extends-erased`
// EXIST BECAUSE R-551 §2 proved the rule convicted ERASED code, and R-551 §3 ordered the corpus
// gap closed in the same wave. Deleting either silently recreates the exact structural blindness
// that let the over-correction hide — `A CORPUS THAT CANNOT SEE A DEFECT CANNOT CERTIFY ITS
// ABSENCE` (AR-596 §2).
// ✅ NO NEW AUTHORITY IS NEEDED: the SAME frozen pin already carries all eight green identities.
export const EXPECTED_GREEN_IDS = Object.freeze(expandedBaseline.GREEN.map((g) => g.id));
const EXPECTED_GREEN_SET = new Set(EXPECTED_GREEN_IDS);
const greenDupes = EXPECTED_GREEN_IDS.filter((id, i) => EXPECTED_GREEN_IDS.indexOf(id) !== i);
if (greenDupes.length) {
  throw new Error(`INSTRUMENT FAULT: expanded pin ${EXPANDED_PIN_COMMIT} yields duplicate GREEN ids: ${[...new Set(greenDupes)].join(', ')}`);
}
// 🛑 DISPOSITION IS PART OF THE CONTRACT (R-561): red and green are NOT merged into one untyped
// set. An id pinned GREEN must never appear in the live CORPUS, and an id pinned RED must never
// appear in the live GREEN — moving a row between them changes what it CLAIMS, and a membership
// check that only asked "does this id exist somewhere" would wave that through.
const crossPinned = EXPECTED_GREEN_IDS.filter((id) => EXPECTED_EXPANDED_SET.has(id));
if (crossPinned.length) {
  throw new Error(`INSTRUMENT FAULT: pin ${EXPANDED_PIN_COMMIT} lists ids as BOTH red and green: ${crossPinned.join(', ')}`);
}

/**
 * The GREEN population, checked exactly as the red one is: BOTH directions plus uniqueness,
 * against a frozen pin the live delivery cannot edit.
 * @param {Array<{id: string}>} greenUnderTest
 * @param {Array<{id: string}>} corpusUnderTest — for the disposition (RED<->GREEN) check
 */
export function checkGreenMembership(greenUnderTest, corpusUnderTest) {
  const actual = greenUnderTest.map((g) => g.id);
  const actualSet = new Set(actual);
  const counts = actual.reduce((a, id) => { a[id] = (a[id] || 0) + 1; return a; }, {});
  const corpusIds = new Set(corpusUnderTest.map((c) => c.id));
  return {
    expected_count: EXPECTED_GREEN_IDS.length,
    actual_count: actual.length,
    missing: EXPECTED_GREEN_IDS.filter((id) => !actualSet.has(id)),
    undeclared: actual.filter((id) => !EXPECTED_GREEN_SET.has(id)),
    duplicated: Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => id),
    // disposition: a pinned-GREEN id appearing among the RED rows, or vice versa
    green_found_in_corpus: EXPECTED_GREEN_IDS.filter((id) => corpusIds.has(id)),
    red_found_in_green: actual.filter((id) => EXPECTED_EXPANDED_SET.has(id)),
  };
}

/**
 * BOTH DIRECTIONS, as item 15 orders. A rename fires on BOTH halves at once:
 * the old id goes MISSING and the new id arrives UNDECLARED.
 * @param {Array<{id: string}>} corpusUnderTest
 */
export function checkMembership(corpusUnderTest) {
  const actual = corpusUnderTest.map((c) => c.id);
  const actualSet = new Set(actual);
  const counts = actual.reduce((a, id) => { a[id] = (a[id] || 0) + 1; return a; }, {});
  return {
    expected_count: EXPECTED_ORIGINAL_IDS.length,
    expected_expanded_count: EXPECTED_EXPANDED_IDS.length,
    actual_count: actual.length,
    // direction 1, the pinned 52: every expected id must still exist under its expected name
    missing: EXPECTED_ORIGINAL_IDS.filter((id) => !actualSet.has(id)),
    // 🛑 R-558 — direction 1 for the EXPANDED population, which had NO gate at all. This is what
    // makes deleting guard row 56(a) fatal: the pinned 53e80935 still expects it, and no edit to
    // this delivery can change what that commit contains.
    missing_expanded: EXPECTED_EXPANDED_IDS.filter((id) => !actualSet.has(id)),
    // direction 2: every id present must be in the pinned expanded set. Legitimate growth bumps
    // EXPANDED_PIN_COMMIT — a reviewable act in git history, not an array edit.
    undeclared: actual.filter((id) => !EXPECTED_EXPANDED_SET.has(id)),
    // uniqueness in the population under test
    duplicated: Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => id),
    // Retained for diagnosis only, and now DERIVED from two pins rather than declared by hand.
    // ⚠️ It no longer carries the gate: `missing_expanded` does, and it cannot be edited away.
    derived_additions_absent: DERIVED_ADDITIONS.filter((id) => !actualSet.has(id)),
  };
}
