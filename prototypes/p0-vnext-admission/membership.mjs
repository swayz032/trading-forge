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
// ⚠️ BUMPED 2026-08-02 `53e80935` -> `27751213` (R-572 §6.1, the batch-closing dance). TWO rows
// were added and the pin moved in a SEPARATE commit, so the gate was RED in between and the
// growth is legible in git history rather than being an array edit that reviews itself:
//   `58`                        the `import.meta` guard row — AR-603 §3 recorded the F-2 repair
//                               as UNGUARDED, with ZERO corpus rows for the channel it fixed.
//   `G-src-new-target-supplied` R-566's adjudication, made enforceable instead of remembered.
// ✅ THREE MAGNITUDES MOVE WITH IT AND EACH STATES ITSELF IN PLAIN SIGHT (`64 -> 65`, `8 -> 9`,
// and the blob), which is exactly what `F-4` proved a bare string cannot do.
export const EXPANDED_PIN_COMMIT = '27751213';

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

// 🛑★★★★★ GRADE F-4 CRITICAL / R-564 item (1) — **PIN THE PIN.**
// I claimed in AR-599 §2 that the coordinated case was "CLOSED BY CONSTRUCTION". THE GRADER
// REFUTED THAT BY EXECUTION: `EXPANDED_PIN_COMMIT` was a bare string with NOTHING asserting its
// value, so bumping it ONE LINE to `9be6a52a` and deleting the five rows that commit lacks —
// `56(a)`–`(d)` and `57`, THE GUARD ROWS FOR BOTH PRIOR CRITICALS — passed every membership
// check, with `expected_expanded_cardinality` silently falling 64 -> 59.
// The grader also named the exact asymmetry: the ORIGINAL pin has an asserted cardinality that
// THROWS; the expanded pin had none. Same file, one guarded, one not — `mint-law` unswept AGAIN.
//   A PIN NOBODY ASSERTS IS A VARIABLE, NOT A PIN.
// Both magnitudes are now asserted, and so is the BLOB — so moving the pin requires editing three
// named constants that each state the expected size in plain sight, and a shrink cannot be silent.
export const EXPANDED_PIN_BLOB = 'd269b5cbce2cc9d03905abac5c816e039a1f9cfd';
export const EXPECTED_EXPANDED_CARDINALITY = 65;
export const EXPECTED_GREEN_CARDINALITY = 9;
if (expandedPin.blob !== EXPANDED_PIN_BLOB) {
  throw new Error(`INSTRUMENT FAULT: expanded pin ${EXPANDED_PIN_COMMIT} resolves to blob ${expandedPin.blob}, expected ${EXPANDED_PIN_BLOB} — the pin moved`);
}
if (expandedBaseline.CORPUS.length !== EXPECTED_EXPANDED_CARDINALITY) {
  throw new Error(`INSTRUMENT FAULT: expanded pin yields ${expandedBaseline.CORPUS.length} CORPUS rows, expected ${EXPECTED_EXPANDED_CARDINALITY} — a silent shrink`);
}
if (expandedBaseline.GREEN.length !== EXPECTED_GREEN_CARDINALITY) {
  throw new Error(`INSTRUMENT FAULT: expanded pin yields ${expandedBaseline.GREEN.length} GREEN rows, expected ${EXPECTED_GREEN_CARDINALITY} — a silent shrink`);
}
// Symmetry, since the asymmetry is what the grader exploited: the ORIGINAL pin gets its blob
// asserted too, not just its cardinality.
export const BASELINE_PIN_BLOB = 'b56e2969c1b6852a2ac42053a14adc62dbe9e899';
if (blob !== BASELINE_PIN_BLOB) {
  throw new Error(`INSTRUMENT FAULT: baseline pin ${BASELINE_COMMIT} resolves to blob ${blob}, expected ${BASELINE_PIN_BLOB} — the pin moved`);
}
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

// 🛑★★★★★ R-562 — THE CLASS FIX. FOUR INSTANCES OF ONE DEFECT WERE RULED ONE AT A TIME:
//   item 15 pinned the red 52 · R-558 the expanded red set · R-561 the GREEN set ·
//   R-562 found TWIN_PAIRS — deleting an entry leaves both rows it names ALIVE, so every
//   membership and disposition check passes while the twin assertions go 2 -> 1, GATE: PASS.
//     THE CHECK IS REMOVED RATHER THAN FAILED.
// Each time, the next victim was THE ADJACENT ARRAY. So this stops enumerating victims and pins
// the CLASS: every self-authored collection any gate consumes, PLUS the SET OF COLLECTION NAMES
// ITSELF — so ADDING A NEW SELF-CERTIFYING ARRAY IS ITSELF A FINDING, and instance five does not
// have to be discovered by hand.
export const EXPECTED_TWIN_KEYS = Object.freeze(
  (expandedBaseline.TWIN_PAIRS ?? []).map((t) => `${t.redId}=>${t.greenId}`),
);
export const EXPECTED_PREREG_KEYS = Object.freeze(Object.keys(expandedBaseline.PREREGISTERED_EMIT_CHANGES ?? {}));

/** A value is a "collection" if a gate could iterate it. Scalars are not self-certifying sets. */
const isCollection = (v) => Array.isArray(v) || v instanceof Set || v instanceof Map
  || (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype);
export const collectionNamesOf = (mod) => Object.keys(mod).filter((k) => isCollection(mod[k])).sort();

/** THE SET OF SETS, frozen. Adding an exported collection to corpus.mjs must be a FINDING. */
export const EXPECTED_COLLECTION_NAMES = Object.freeze(collectionNamesOf(expandedBaseline));

// 🛑★★★★★ `EXEMPT_EXPORTS` IS DELETED (R-570 §4, ruling on AR-607 §5's measurement). It read:
//     export const EXEMPT_EXPORTS = Object.freeze({ NOT_IMPLEMENTED: '…', CONTAINER_TWIN_TS: '…', … });
// and its caption claimed "EXEMPTIONS, DECLARED IN CODE WITH A STATED REASON (R-562 item 2 allows
// pin-or-exempt)". `grep -rn EXEMPT_EXPORTS *.mjs` returned exactly ONE hit — its own declaration.
// ZERO CONSUMERS. Scalars are excluded by `isCollection` returning false, never by this table.
// 🛑 THE DANGER WAS THE **ACTIVE** DIRECTION, not the dead one: a future seat adding a name here to
// exempt a REAL collection would have seen the check fire anyway.
//   A CAPABILITY ADVERTISED AND ABSENT IS WORSE THAN ONE NEVER CLAIMED.
// Same species as `F-5` `classifyPosition`, deleted by R-564 item (4) for exactly this reason.
// ✅ If this campaign later wants pin-or-exempt it gets BUILT — with a consumer and a red-proof —
// not resurrected from a decoration.

/**
 * R-562: every remaining self-authored collection, both directions plus uniqueness, against the
 * same frozen pin — and the set of collection NAMES, so a NEW unpinned array is itself a finding.
 */
export function checkAuxiliaryCollections(live) {
  const twinKeys = (live.TWIN_PAIRS ?? []).map((t) => `${t.redId}=>${t.greenId}`);
  const prereg = Object.keys(live.PREREGISTERED_EMIT_CHANGES ?? {});
  const names = live.collectionNames;
  const dupes = (a) => [...new Set(a.filter((x, i) => a.indexOf(x) !== i))];
  return {
    twin_missing: EXPECTED_TWIN_KEYS.filter((k) => !twinKeys.includes(k)),
    twin_undeclared: twinKeys.filter((k) => !EXPECTED_TWIN_KEYS.includes(k)),
    twin_duplicated: dupes(twinKeys),
    prereg_missing: EXPECTED_PREREG_KEYS.filter((k) => !prereg.includes(k)),
    prereg_undeclared: prereg.filter((k) => !EXPECTED_PREREG_KEYS.includes(k)),
    collection_missing: EXPECTED_COLLECTION_NAMES.filter((n) => !names.includes(n)),
    collection_undeclared: names.filter((n) => !EXPECTED_COLLECTION_NAMES.includes(n)),
    expected_twin_count: EXPECTED_TWIN_KEYS.length,
    expected_prereg_count: EXPECTED_PREREG_KEYS.length,
    expected_collection_names: EXPECTED_COLLECTION_NAMES,
  };
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
