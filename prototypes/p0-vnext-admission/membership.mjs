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

export function loadBaselineCorpus() {
  const raw = execFileSync('git', ['show', `${BASELINE_COMMIT}:${BASELINE_REPO_PATH}`], { cwd: HERE, encoding: 'utf8' });
  const blob = execFileSync('git', ['rev-parse', `${BASELINE_COMMIT}:${BASELINE_REPO_PATH}`], { cwd: HERE, encoding: 'utf8' }).trim();
  const abs = (n) => JSON.stringify(pathToFileURL(path.join(HERE, n)).href);
  let subs = 0;
  const patched = raw.replace(/from '\.\/(source-admission|runtime-admission)\.mjs'/g, (_m, n) => { subs += 1; return `from ${abs(`${n}.mjs`)}`; });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p0vnext-baseline-'));
  const f = path.join(dir, 'baseline-corpus.mjs');
  fs.writeFileSync(f, patched);
  return { file: f, substitutions: subs, rawBytes: raw.length, blob };
}

// The ONE historical identity change between AR-589's corpus and this one. It is declared here
// because item 15 names it explicitly: AR-589's row `54` was the module-scope `this` STATEMENT,
// which now lives at `54(c)`. The CURRENT row `54` is the container twin — a DIFFERENT OBJECT
// that was never in AR-589's 52 and must NOT be scored as if it were.
export const HISTORICAL_RENAMES = Object.freeze({ '54': '54(c)' });

// Rows present in the corpus under test that were NEVER part of AR-589's 52. This is a
// DECLARATION ABOUT ADDITIONS — it does not derive expected membership from anything. Its only
// power is to say "these ids are allowed to be new"; an id that is neither expected nor declared
// here is reported as an undeclared arrival rather than absorbed.
export const DECLARED_ADDITIONS = Object.freeze([
  '34(d-u)', '54', '54(b)', '55(a)', '55(b)', '55(c)', '55(d)',
  // added from the accuracy-validator's HUNT (F-1/F-2 guards)
  '56(a)', '56(b)', '56(c)', '56(d)', '57',
  // ⚠️ AR-596's two `implements` / interface-`extends` rows are NOT listed here and that is
  // correct, not an omission: they were added as GREEN NEIGHBOURS
  // (`G-src-implements-erased`, `G-src-interface-extends-erased`), which are a different
  // population from the scored CORPUS. `[MEASURED]` — listing them produced
  // `declared_but_absent: ["58(a)","58(b)"]` on my first run, which is exactly the report a
  // stale declaration is supposed to produce, and it corrected me.
]);

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

/**
 * BOTH DIRECTIONS, as item 15 orders. A rename fires on BOTH halves at once:
 * the old id goes MISSING and the new id arrives UNDECLARED.
 * @param {Array<{id: string}>} corpusUnderTest
 */
export function checkMembership(corpusUnderTest) {
  const actual = corpusUnderTest.map((c) => c.id);
  const actualSet = new Set(actual);
  const declared = new Set([...EXPECTED_ORIGINAL_IDS, ...DECLARED_ADDITIONS]);
  const counts = actual.reduce((a, id) => { a[id] = (a[id] || 0) + 1; return a; }, {});
  return {
    expected_count: EXPECTED_ORIGINAL_IDS.length,
    actual_count: actual.length,
    // direction 1: every expected id must still exist under its expected name
    missing: EXPECTED_ORIGINAL_IDS.filter((id) => !actualSet.has(id)),
    // direction 2: every id present must be expected or declared-new
    undeclared: actual.filter((id) => !declared.has(id)),
    // uniqueness in the population under test
    duplicated: Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => id),
    // a declared addition that never arrived is a stale declaration, reported not enforced
    declared_but_absent: DECLARED_ADDITIONS.filter((id) => !actualSet.has(id)),
  };
}
