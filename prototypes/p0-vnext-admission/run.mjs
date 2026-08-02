// Runner: executes every corpus subcase and attributes each verdict to the catcher that
// actually fired. Honours the design's laws:
//   VALIDITY BEFORE VERDICT     - a parse OR TYPE failure is a FAILED proof, never a pass
//   WRONG CATCHER = FAILED      - red via a different rule than the named one is a MISS
//   SINGLE DIAGNOSTIC OWNERSHIP - "attributed" means the named catcher fired AND every
//                                 competing catcher stayed SILENT (R-543 s4 item 3)
//   HONEST NAMED MISSES         - reported, never absorbed into the coverage number
//
// R-544 s3 item 9 -- THIS RUNNER ENFORCES. It exits NON-ZERO on every forbidden outcome
// listed in FAILURE_CLASSES below, and `red-proof.mjs` demonstrates a live red path for
// each one plus a 0 on the clean control. Until that demonstration existed this file was
// MEASUREMENT-ONLY, because a gate with no path to red is a green check that cannot fail.
import { OPENED } from './fs-tracker.mjs';   // FIRST: patches fs before any rule module reads
import { admitSource, surfaceHealth, effectiveModuleTuple, SURFACE_DIR } from './source-admission.mjs';
import { emitAndExecuteTuple } from './module-tuple.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { admitRuntime } from './runtime-admission.mjs';
import { CORPUS, GREEN, TWIN_PAIRS, NOT_IMPLEMENTED, ORIGINAL_52_IDS } from './corpus.mjs';

globalThis.__GETTER_HITS__ = 0;

// Test-only mutation injector. It plants ONE defect so the enforcement path can be shown to
// go RED (R-544 s3 item 9 requires a demonstrated red path per class). It is OFF unless the
// env var is set, and the clean control run below proves the off-branch is the real one.
// This gates a TEST INJECTION, never a repair -- no correctness fix hides behind a flag.
const INJECT = process.env.PROTO_INJECT || '';

// ---------------------------------------------------------------------------------------
// R-546 §5.0 — `miss_type_invalid` CONFLATED THREE POPULATIONS AND IS RETIRED. Each now has
// its own denominator, and the PRECEDENCE below is stated because it decides the answer:
//
//  (i)   SURFACE-INVALID       the INSTRUMENT is unconfigured. Not a miss. FIX THE SURFACE.
//                              Enters NO numerator or denominator. A non-empty set after
//                              item 2 makes the whole number INADMISSIBLE.
//  (ii)  FIXTURE-INVALID       an AUTHORING defect. Not a miss. FIX THE FIXTURE.
//  (iii) CAUGHT_BY_TYPECHECKER the planted illegality IS ITSELF a type error. NOT a failed
//                              proof — a real catch by a DIFFERENT layer, and the desk's own
//                              order would have permanently deleted this legitimate class.
//
// Surface is checked FIRST because an unconfigured instrument can manufacture any of the
// others; a row carrying BOTH a surface code and a real catch is reported as surface-invalid
// and its verdict is withheld rather than guessed.
const SURFACE_CODES = ['TS7006', 'TS2792', 'TS7017', 'TS1192', 'TS2591', 'TS2835', 'TS2724'];
const TYPECHECKER_CAUGHT_CODES = ['TS2304', 'TS2540', 'TS2532', 'TS1117', 'TS2339'];
// 🛑 FOUND BY THE accuracy-validator: `FIXTURE_INVALID` had NO ASSIGNMENT SITE — the value was
// unreachable, so "fixture_invalid: 0" was DEFINITIONAL, not measured. A five-population
// partition wearing a six-population caption. The class now has real members: diagnostics that
// indicate the FIXTURE WAS WRITTEN WRONG (an authoring defect) rather than the instrument being
// unconfigured or the planted illegality being caught. Red-proofed like every other class.
const FIXTURE_INVALID_CODES = ['TS2554', 'TS2345', 'TS2559', 'TS2739', 'TS2741', 'TS2769'];
function classifyTypeInvalid(diagnostics) {
  const codes = diagnostics.map((d) => d.split(':')[0]);
  if (codes.some((c) => SURFACE_CODES.includes(c))) return 'SURFACE_INVALID';
  if (codes.some((c) => FIXTURE_INVALID_CODES.includes(c))) return 'FIXTURE_INVALID';
  if (codes.every((c) => TYPECHECKER_CAUGHT_CODES.includes(c))) return 'CAUGHT_BY_TYPECHECKER';
  // Neither recognised: FAIL CLOSED into its own reported bucket rather than being folded
  // into whichever population happens to be convenient.
  return 'TYPE_INVALID_UNCLASSIFIED';
}

// The duplicate-id injection plants a REAL duplicate row, so the id-uniqueness check runs on
// genuinely duplicated data rather than on a flipped flag.
const CORPUS_UNDER_TEST = INJECT === 'partition_overlap' ? [...CORPUS, { ...CORPUS.find((c) => c.id === '38') }] : CORPUS;

const results = [];
for (const c of CORPUS_UNDER_TEST) {
  let outcome = 'REJECTED', fired = [], detail = '', tuple = null, diagnostics = [], submittedBody = null;
  if (c.kind === 'source') {
    let body = c.body;
    // Each injection MUTATES A FIXTURE, never an expectation -- a mutation that edits only
    // the assertion cannot show the detector works.
    if (INJECT === 'wrong_catcher' && c.id === '35(a)') body = `let leak = 1;\nexport const project = (lane: Lane) => ({ v: leak });\n`;
    if (INJECT === 'ownership' && c.id === '34(b)') body = `let leak = 1;\nexport const getLedger = () => 1;\nexport const project = (lane: Lane) => ({ v: leak });\n`;
    if (INJECT === 'parse' && c.id === '35(a)') body = `export const project = (lane: Lane) => ({ v: ;\n`;
    // R-546 §7's stop conditions get red paths too — a class I enforce without a
    // demonstrated red is the same "green check with no path to red" I am here to close.
    if (INJECT === 'surface_invalid_rows' && c.id === '35(b)') body = `export const project = (lane) => ({ v: window.__ledger });\n`;
    // An ENUM MEMBER name is in neither type nor value space under this rule. The previous
    // injection used a labeled statement, which STOPPED reaching the residual once label
    // handling was added — a red path can be silently retired by an unrelated repair, so it
    // is re-measured rather than assumed.
    if (INJECT === 'position_unclassified' && c.id === '35(b)') body = `enum E { A = 1 }\nexport const project = (lane: Lane) => ({ v: window.__ledger });\n`;
    if (INJECT === 'fixture_invalid' && c.id === '48') body = `const C = deepFreeze({ a: 1 }, 2);\nexport const project = (lane: Lane) => ({ v: C.a });\n`;
    if (INJECT === 'type_invalid_unclassified' && c.id === '48') body = `const C = Object.freeze({ a: 1 });\nexport const project = (lane: Lane) => ({ v: C.a === 'x' });\n`;
    submittedBody = body;
    const r = admitSource(c.file, body);
    outcome = r.outcome; tuple = r.tuple; diagnostics = r.diagnostics || [];
    if (INJECT === 'tuple_disagreement' && c.id === '54' && tuple) tuple = { ...tuple, tsImpliedNodeFormat: 'ESM', formatAgreement: false };
    fired = r.violations.map((v) => v.catcher);
    detail = r.violations.map((v) => `${v.catcher} @ ${v.path}`).join(' | ');
  } else {
    const r = admitRuntime(c.factory());
    outcome = r.violations.length ? 'REJECTED' : 'ADMITTED';
    fired = r.violations.map((v) => v.catcher);
    detail = r.violations.map((v) => `${v.catcher} @ ${v.path}`).join(' | ');
  }
  const uniqFired = [...new Set(fired)];
  const competing = uniqFired.filter((f) => f !== c.expect);
  let status;
  if (outcome === 'PARSE_ERROR') status = 'FAILED_PARSE';
  else if (outcome === 'TYPE_INVALID') status = classifyTypeInvalid(diagnostics);
  else if (uniqFired.includes('POSITION_UNCLASSIFIED')) status = 'POSITION_UNCLASSIFIED';
  else if (c.expect === NOT_IMPLEMENTED) status = 'MISS_NOT_IMPLEMENTED';
  else if (uniqFired.includes(c.expect) && competing.length === 0) status = 'ATTRIBUTED';
  else if (uniqFired.includes(c.expect)) status = 'FAILED_OWNERSHIP';   // named fired, but not alone
  else if (uniqFired.length > 0) status = 'FAILED_WRONG_CATCHER';
  else status = 'MISS_NOT_CAUGHT';
  results.push({ id: c.id, atom: c.atom, expect: c.expect, file: c.file, fired: uniqFired, competing, status, detail, tuple, diagnostics, submittedBody });
}

// ---- GREEN neighbours must be ADMITTED ----
const greens = GREEN.map((g) => {
  let body = g.body;
  if (INJECT === 'green_rejected' && g.id === 'G-src-clean') body = `let leak = 1;\n${g.body}`;
  // The twin injection reproduces the EXACT defect R-544 convicted: a "twin" whose arms
  // differ by an edited line. The assertion must catch it.
  if (INJECT === 'twin' && g.id === 'G-src-container-twin-esm') body = `${g.body}// twin arms no longer byte-identical\n`;
  const r = g.kind === 'source' ? admitSource(g.file, body) : admitRuntime(g.factory());
  return {
    id: g.id, file: g.file, ok: g.kind === 'source' ? r.outcome === 'ADMITTED' : (r.violations || []).length === 0,
    outcome: r.outcome || (r.violations.length ? 'REJECTED' : 'ADMITTED'),
    detail: (r.violations || []).map((v) => `${v.catcher} @ ${v.path}`).join(' | '),
    tuple: r.tuple || null,
    submittedBody: g.kind === 'source' ? body : null,
  };
});

// ---- ITEM 7: THE TWIN ASSERTION, CHECKED RATHER THAN ASSUMED ----
// "A twin that differs by the deleted line is not a control -- it is the mutation run
// backwards." So the runner proves the two arms are the SAME BYTES and that the ONLY
// catcher separating them is the module system.
// MEASURED CORRECTION (found by red-proof.mjs, not by review): this comparison originally
// read the bodies DECLARED in corpus.mjs. That is the wrong join key -- it asserts what the
// corpus says, not what the rule was actually handed. It now compares the bytes ACTUALLY
// SUBMITTED to admitSource, so a divergence anywhere between declaration and submission is
// visible. The red-proof's `twin` class did not go red until this was fixed.
const twinChecks = TWIN_PAIRS.map(({ redId, greenId }) => {
  const redRes = results.find((r) => r.id === redId), grnRes = greens.find((g) => g.id === greenId);
  const sameBytes = redRes.submittedBody === grnRes.submittedBody;
  const redOnlyModuleSystem = redRes.fired.length === 1 && redRes.fired[0] === '1b-S:module-system';
  return {
    pair: `${redId} (${redRes.file}) vs ${greenId} (${grnRes.file})`,
    sameBytes,
    byteLength: redRes.submittedBody.length,
    redFormat: redRes.tuple?.format, greenFormat: grnRes.tuple?.format,
    redOnlyModuleSystem,
    greenAdmitted: grnRes.ok,
    ok: sameBytes && redOnlyModuleSystem && grnRes.ok && redRes.tuple?.format === 'CJS' && grnRes.tuple?.format === 'ESM',
  };
});

// ---- TUPLE AGREEMENT: my derivation vs TypeScript's own impliedNodeFormat ----
const tupleDisagreements = [...results, ...greens]
  .filter((r) => r.tuple && r.tuple.formatAgreement === false)
  .map((r) => `${r.id}: mine=${r.tuple.format} ts=${r.tuple.tsImpliedNodeFormat}`);

// ---- NEGATIVE CONTROL: a subcase naming a catcher no rule emits must be REPORTED ----
const ctrlRes = admitRuntime({ id: 'L1', a: 1 });
const negControl = {
  planted: '1b-R:no-such-rule',
  reported: INJECT === 'neg_control' ? false : !ctrlRes.violations.some((v) => v.catcher === '1b-R:no-such-rule'),
};

// ---- SURFACE HEALTH: does the pinned surface itself compile? ----
// The injection adds a REAL broken root, so the detector's real diagnostic path runs.
let extraRoots = [];
if (INJECT === 'surface_health') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p0vnext-broken-'));
  const broken = path.join(d, 'broken.ts').replace(/\\/g, '/');
  fs.writeFileSync(broken, 'export const bad: number = "not a number";\n');
  extraRoots = [broken];
}
const health = surfaceHealth({ extraRoots });

// ---- ITEM 5 + ITEM 7 (second half): emit the artifact and EXECUTE it ----
const emitted = emitAndExecuteTuple({ injectWrongContainer: INJECT === 'emitted_module' });

const tally = (s) => results.filter((r) => r.status === s).length;
const summary = {
  total: results.length,
  attributed: tally('ATTRIBUTED'),
  miss_not_implemented: tally('MISS_NOT_IMPLEMENTED'),
  miss_type_invalid: tally('MISS_TYPE_INVALID'),
  miss_not_caught: tally('MISS_NOT_CAUGHT'),
  failed_wrong_catcher: tally('FAILED_WRONG_CATCHER'),
  failed_ownership: tally('FAILED_OWNERSHIP'),
  failed_parse: tally('FAILED_PARSE'),
  green_admitted: greens.filter((g) => g.ok).length,
  green_total: greens.length,
  getter_invocations: globalThis.__GETTER_HITS__ + (INJECT === 'getter' ? 1 : 0),
};

// ---- THE PRE-REGISTERED COMPARISON, COMPUTED RATHER THAN ASSERTED ----
// Scored over AR-589's ORIGINAL 52 ids only, so the fall is measured against the same
// population and not against a corpus that grew underneath the number.
const orig = ORIGINAL_52_IDS.map((id) => results.find((r) => r.id === id));
const origTally = (s) => orig.filter((r) => r.status === s).length;
// ---- R-546 §6: THE SIX-POPULATION PARTITION. THE CLAIM UNDER TEST IS THE PARTITION, NOT
// ---- THE RATIO. `attributed` may go up or down; neither direction is success on its own.
const SIX = {
  attributed: 'ATTRIBUTED',
  honest_named_miss: 'MISS_NOT_IMPLEMENTED',
  surface_invalid: 'SURFACE_INVALID',
  fixture_invalid: 'FIXTURE_INVALID',
  caught_by_typechecker: 'CAUGHT_BY_TYPECHECKER',
  position_unclassified: 'POSITION_UNCLASSIFIED',
};
const partition = Object.fromEntries(Object.entries(SIX).map(([k, s]) => [k, orig.filter((r) => r.status === s).map((r) => r.id)]));
const partitionSum = Object.values(partition).reduce((a, ids) => a + ids.length, 0);
// Any row landing in NONE of the six is itself the finding — it is not quietly absorbed.
const unpartitioned = orig.filter((r) => !Object.values(SIX).includes(r.status)).map((r) => `${r.id}:${r.status}`);
const inTwo = Object.entries(partition).flatMap(([k, ids]) => ids.map((id) => ({ id, k })))
  .reduce((acc, { id }) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {});
// 🛑 FOUND BY THE accuracy-validator: I declared this check STRUCTURALLY UNREACHABLE on the
// grounds that a row has exactly one STATUS. That argument was sound about statuses and SILENT
// ABOUT IDS — a DUPLICATE CORPUS ID puts the same id in the partition twice. The declaration
// was convenient, not true, and it is withdrawn. The id-uniqueness check below is the missing
// half, and both are now red-proofed.
const idCounts = CORPUS_UNDER_TEST.reduce((a, c) => { a[c.id] = (a[c.id] || 0) + 1; return a; }, {});
const duplicateCorpusIds = Object.entries(idCounts).filter(([, n]) => n > 1).map(([id]) => id);
const duplicated = [...new Set([...Object.entries(inTwo).filter(([, n]) => n > 1).map(([id]) => id), ...duplicateCorpusIds])];

const likeForLike = {
  population: 'AR-589 original 52 subcases, by id',
  total: orig.length,
  six_population_partition: Object.fromEntries(Object.entries(partition).map(([k, ids]) => [k, ids.length])),
  partition_sums_to: partitionSum,
  partition_must_sum_to: 52,
  rows_in_two_populations: duplicated,
  rows_in_no_population: unpartitioned,
  members: partition,
  ar589_claim: '49 / 52 (retired as the test — R-546 §6 replaced "the number must fall")',
  missing_ids: ORIGINAL_52_IDS.filter((id) => !results.some((r) => r.id === id)),
};

// A miss must show WHY it missed, or the table hides the very thing it is reporting.
const why = (r) => {
  if (r.status === 'ATTRIBUTED') return r.expect;
  if (r.status === 'MISS_TYPE_INVALID') return (r.diagnostics.join(' + ') || 'TYPE_INVALID').slice(0, 78);
  return r.fired.join(',') || '<none fired>';
};
const line = (r) => `${r.id.padEnd(9)} ${r.status.padEnd(22)} ${r.atom.slice(0, 40).padEnd(40)} ${why(r)}`;
console.log('P0-vNext ADMISSION PROTOTYPE — COVERAGE RUN');
console.log(`PINNED SURFACE: ${SURFACE_DIR}`);
console.log(`EFFECTIVE-MODULE TUPLE (reference, fixture.ts): ${JSON.stringify(effectiveModuleTuple(`${SURFACE_DIR}/fixture.ts`))}`);
console.log('='.repeat(116));
for (const r of results) console.log(line(r));
console.log('='.repeat(116));
console.log('GREEN NEIGHBOURS (must be admitted):');
for (const g of greens) console.log(`  ${g.id.padEnd(28)} ${g.ok ? 'ADMITTED' : '*** REJECTED *** ' + g.detail}`);
console.log('='.repeat(116));
console.log('TWIN ASSERTION (item 7 — one source text, two containers):');
for (const t of twinChecks) console.log(`  ${t.ok ? 'PASS' : '*** FAIL ***'} ${t.pair} | sameBytes=${t.sameBytes} (${t.byteLength}B) | ${t.redFormat}->only-module-system=${t.redOnlyModuleSystem} | ${t.greenFormat}->admitted=${t.greenAdmitted}`);
console.log('='.repeat(116));
console.log(`SURFACE HEALTH (pinned surface compiles clean): ${health.clean} ${health.clean ? `[${health.roots.join(', ')}]` : JSON.stringify(health.diags)}`);
console.log(`TUPLE CROSS-CHECK (my derivation vs ts.impliedNodeFormat): ${tupleDisagreements.length === 0 ? 'AGREE on all rows' : JSON.stringify(tupleDisagreements)}`);
console.log(`EMITTED ARTIFACT EXECUTED (items 5 + 7): ESM top-level \`this\`=${JSON.stringify(emitted.arms[0].observedTopLevelThis)} | CJS POSITIVE CONTROL \`this\`=${JSON.stringify(emitted.arms[1].observedTopLevelThis)} | ${emitted.note}`);
console.log(`PINNED SURFACE HASH (sha256 over ${Object.keys(emitted.surfaceHash.files).length} committed files): ${emitted.surfaceHash.combined}`);
console.log(JSON.stringify(summary, null, 2));
console.log('LIKE-FOR-LIKE vs AR-589 (same 52 ids, NOT the expanded corpus):');
console.log(JSON.stringify(likeForLike, null, 2));
console.log(`NEGATIVE CONTROL: planted catcher '${negControl.planted}' correctly absent from a clean run: ${negControl.reported}`);
console.log(`GETTER INVOCATION COUNTER (required 0): ${summary.getter_invocations}`);

// ---- SEPARABILITY: measured by OBSERVED READS, not by grepping my own source ----
// The first version grepped this file for the forbidden filenames and matched its OWN
// literals, reporting 2. A check that reads its own assertion list is measuring itself.
if (INJECT === 'ledger_read') OPENED.add('C:/fake/P1-P2-TOTAL-MEMBERSHIP-2026-07-31.json');
const ledgerHits = [...OPENED].filter((f) => /P1-P2-TOTAL-MEMBERSHIP|ORACLE\.json/.test(f));
console.log(`SEPARABILITY: files actually opened during this run: ${OPENED.size}`);
console.log(`SEPARABILITY: ledger/oracle artifacts opened: ${ledgerHits.length} (required 0)`);
console.log(`SEPARABILITY POSITIVE CONTROL: the tracker DID observe ${OPENED.size} real reads, so a 0 above is a measured absence, not a dead probe.`);

// ---------------------------------------------------------------------------------------
// ITEM 9 -- ENFORCEMENT. Every forbidden outcome derives a non-zero exit.
// ---------------------------------------------------------------------------------------
const FAILURE_CLASSES = [
  ['wrong_catcher', summary.failed_wrong_catcher > 0, () => `${summary.failed_wrong_catcher} row(s) red via a catcher other than the named one`],
  ['ownership', summary.failed_ownership > 0, () => `${summary.failed_ownership} row(s) where the named catcher fired but a competing catcher also fired`],
  ['parse', summary.failed_parse > 0, () => `${summary.failed_parse} fixture(s) failed to parse`],
  ['green_rejected', summary.green_admitted !== summary.green_total, () => `${summary.green_total - summary.green_admitted} green neighbour(s) rejected`],
  ['neg_control', negControl.reported !== true, () => 'the negative control did not convict'],
  ['getter', summary.getter_invocations !== 0, () => `${summary.getter_invocations} getter invocation(s)`],
  ['ledger_read', ledgerHits.length > 0, () => `${ledgerHits.length} ledger/oracle read(s): ${ledgerHits.join(', ')}`],
  ['surface_health', !health.clean, () => `pinned surface does not compile: ${health.diags.join('; ')}`],
  ['twin', twinChecks.some((t) => !t.ok), () => `twin assertion failed: ${twinChecks.filter((t) => !t.ok).map((t) => t.pair).join(', ')}`],
  ['tuple_disagreement', tupleDisagreements.length > 0, () => `module-format derivations disagree: ${tupleDisagreements.join('; ')}`],
  ['emitted_module', !emitted.ok, () => `emitted-artifact execution failed: ESM this=${JSON.stringify(emitted.arms[0].observedTopLevelThis)} (need "undefined"), CJS control this=${JSON.stringify(emitted.arms[1].observedTopLevelThis)} (need "object")`],
  // R-546 §7's new stop conditions, enforced rather than merely reported.
  ['surface_invalid_rows', likeForLike.six_population_partition.surface_invalid > 0, () => `${likeForLike.six_population_partition.surface_invalid} row(s) SURFACE-INVALID after item 2 — the number is INADMISSIBLE: ${partition.surface_invalid.join(', ')}`],
  ['partition_sum', partitionSum !== 52, () => `the six populations sum to ${partitionSum}, not 52`],
  ['partition_overlap', duplicated.length > 0, () => `row(s) in two populations: ${duplicated.join(', ')}`],
  ['partition_orphan', unpartitioned.length > 0, () => `row(s) in no population: ${unpartitioned.join(', ')}`],
  ['position_unclassified', results.some((r) => r.status === 'POSITION_UNCLASSIFIED'), () => `${results.filter((r) => r.status === 'POSITION_UNCLASSIFIED').length} row(s) with an identifier position the rule cannot classify (fails closed)`],
  // R-546 §5.0(ii): a fixture-invalid row is an AUTHORING defect and the order is FIX THE
  // FIXTURE — so it fails the gate rather than sitting in the table as a tolerated number.
  ['fixture_invalid', results.some((r) => r.status === 'FIXTURE_INVALID'), () => `${results.filter((r) => r.status === 'FIXTURE_INVALID').map((r) => `${r.id} [${r.diagnostics.join(';')}]`).join(' | ')}`],
  ['type_invalid_unclassified', results.some((r) => r.status === 'TYPE_INVALID_UNCLASSIFIED'), () => `${results.filter((r) => r.status === 'TYPE_INVALID_UNCLASSIFIED').map((r) => `${r.id} [${r.diagnostics.join(';')}]`).join(' | ')}`],
];
const failures = FAILURE_CLASSES.filter(([, hit]) => hit).map(([name, , msg]) => `${name}: ${msg()}`);

console.log('='.repeat(116));
if (failures.length) {
  console.log(`GATE: FAIL (${failures.length} class(es))`);
  for (const f of failures) console.log(`  *** ${f}`);
} else {
  console.log('GATE: PASS — every enforced class is clean. Misses are honest and do NOT fail the gate.');
}
console.log(`INJECTION: ${INJECT || '<none — this is the clean control>'}`);
process.exitCode = failures.length ? 1 : 0;

export { results, summary, greens, twinChecks, failures, health };
