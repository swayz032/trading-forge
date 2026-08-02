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
import { CORPUS, GREEN, TWIN_PAIRS, NOT_IMPLEMENTED } from './corpus.mjs';
// R-562 item 3: the SET OF SETS needs the module NAMESPACE, not named imports — the whole point is
// to notice an exported collection nobody named.
import * as corpusModule from './corpus.mjs';
// ITEM 15: expected membership comes from the PINNED AR-589 artifact, never from `CORPUS`.
import {
  EXPECTED_ORIGINAL_IDS, checkMembership, checkGreenMembership, checkAuxiliaryCollections,
  collectionNamesOf, BASELINE_META, EXPANDED_META,
} from './membership.mjs';
// R-568 item (5): the set-of-sets extended past corpus.mjs to the ENFORCEMENT TABLES.
import { checkPinnedCollections, assertParserAgreesWithRuntime, loadPinnedText } from './module-collections.mjs';

globalThis.__GETTER_HITS__ = 0;

// Test-only mutation injector. It plants ONE defect so the enforcement path can be shown to
// go RED (R-544 s3 item 9 requires a demonstrated red path per class). It is OFF unless the
// env var is set, and the clean control run below proves the off-branch is the real one.
// This gates a TEST INJECTION, never a repair -- no correctness fix hides behind a flag.
const INJECT = process.env.PROTO_INJECT || '';

// 🛑★★★★★ R-568 item (5) — THE SET OF SETS, BEYOND `corpus.mjs`. THIS RUNS BEFORE ANYTHING
// ELSE AND IS DELIBERATELY **NOT** A `FAILURE_CLASSES` ENTRY.
//
// WHY IT SITS OUTSIDE THE TABLE IT PROTECTS, measured rather than argued (AR-607 §1):
//   deleting the `collection_shape` entry from `FAILURE_CLASSES` (5 lines) made the very
//   injection that reddens this gate report `GATE: PASS`, `EXIT 0`. `failures` is
//   `FAILURE_CLASSES.filter(...)` — BOTH OPERANDS FROM THE SAME MUTABLE ARRAY, which is
//   R-561's defect on the enforcement list itself. A check registered IN that array could
//   be retired by the same edit it exists to catch, so this one cannot live there.
// It prints `GATE: FAIL` and names its class so `red-proof.mjs` can assert it exactly like
// any other class, then exits immediately — nothing downstream can downgrade it.
const collectionFindings = checkPinnedCollections({
  simulateDelete: INJECT === 'module_collection_delete'
    ? { file: 'red-proof.mjs', collection: 'EXPECT', key: 'new_unpinned_collection' } : null,
  simulateAdd: INJECT === 'module_collection_add'
    ? { file: 'run.mjs', collection: 'ROGUE_UNPINNED_TABLE' } : null,
});
// ⚠️ THE PARSER IS NEVER TRUSTED ON ITS OWN WORD. It is compared against the EXECUTED
// runtime reader on `corpus.mjs` — the one module where both paths work — and on the SAME
// BLOB, because comparing two revisions would be measuring the neighbouring object. This
// cross-check already earned its place: it caught this parser blind to object-literal
// collections (`PREREGISTERED_EMIT_CHANGES`) before the check shipped.
assertParserAgreesWithRuntime(loadPinnedText(EXPANDED_META.commit, 'corpus.mjs').raw, collectionNamesOf(corpusModule));
if (collectionFindings.length) {
  console.log('='.repeat(116));
  console.log(`GATE: FAIL (${collectionFindings.length} class(es))`);
  for (const f of collectionFindings) console.log(`  *** module_collections: ${f}`);
  console.log(`INJECTION: ${INJECT || '<none — this is the clean control>'}`);
  process.exit(1);
}

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
// 🛑 ITEM 14 (R-548 §4) — `TYPECHECKER_CAUGHT_CODES` IS DELETED. It was:
//     const TYPECHECKER_CAUGHT_CODES = ['TS2304','TS2540','TS2532','TS1117','TS2339'];
//     ... codes.every((c) => TYPECHECKER_CAUGHT_CODES.includes(c))
// ONE GLOBAL LIST, consulted by membership, with `classifyTypeInvalid` receiving nothing but
// diagnostic strings — no row id, no expected mutation, no span. R-548 §2's attack A planted an
// UNRELATED `TS2339` on row 35(a) and BOUGHT IT A COVERAGE CREDIT: attributed 44 -> 43,
// caught_by_typechecker 5 -> 6, gate exit 0.
//   AN ERROR CODE IS A TYPE OF EVENT, NOT PROOF THE EVENT BELONGS TO THIS MUTATION.
// R-555 §5 forbids the obvious near-miss too: a per-row CODE LIST is still not an ownership key.
// The key is (ROW, OWNED EXPRESSION, SPAN, EXPECTED DEFECT) — declared per row in corpus.mjs as
// `typecheckerOwned`, and joined below against the compiler's own diagnostic SPANS.
//
// ⚠️ WHAT IS *NOT* DELETED, AND WHY THAT IS NOT THE SAME DEFECT: `SURFACE_CODES` and
// `FIXTURE_INVALID_CODES` remain global lists, and they must, because neither GRANTS A ROW ANY
// CREDIT. Surface codes WITHHOLD a verdict (the instrument is unconfigured); fixture-invalid
// codes FAIL THE GATE. Item 14 forbids a list that buys coverage, not every list of codes.
// Both of these fail toward stopping the run; the deleted one failed toward flattering it.
// 🛑 FOUND BY THE accuracy-validator: `FIXTURE_INVALID` had NO ASSIGNMENT SITE — the value was
// unreachable, so "fixture_invalid: 0" was DEFINITIONAL, not measured. A five-population
// partition wearing a six-population caption. The class now has real members: diagnostics that
// indicate the FIXTURE WAS WRITTEN WRONG (an authoring defect) rather than the instrument being
// unconfigured or the planted illegality being caught. Red-proofed like every other class.
const FIXTURE_INVALID_CODES = ['TS2554', 'TS2345', 'TS2559', 'TS2739', 'TS2741', 'TS2769'];
// ---- ITEM 14: THE ROW-BOUND OWNERSHIP JOIN --------------------------------------------
// A diagnostic may credit a row ONLY IF it is ENTAILED BY THAT ROW'S PLANTED ILLEGALITY, and
// entailment is evidenced by the diagnostic pointing AT the declared expression. Two directions,
// both required, because either one alone is buyable:
//   1. EVERY diagnostic must join to a declared anchor  -> an EXTRA or UNRELATED diagnostic
//      cannot ride along on a row that legitimately owns another one.
//   2. EVERY declared anchor must be witnessed          -> the declaration is falsifiable; a
//      stale or aspirational anchor is a finding, not a formality.
// The anchor must be UNIQUE in the submitted body, or the span join is guesswork.
function ownershipJoin(records, row, body) {
  const owned = row.typecheckerOwned;
  if (!owned || owned.length === 0) {
    return { ok: false, why: `row declares NO typecheckerOwned anchor, so no diagnostic can be credited to it [${records.map((r) => r.code).join('+')}]` };
  }
  const anchors = [];
  for (const o of owned) {
    // 🛑★★★★★ GRADE F-3 / R-568 item (2) — FAIL CLOSED ON A MISSING WITNESS.
    // An anchor with no declared witness would silently get the OLD, SUBSTITUTABLE behaviour, and
    // a future row could opt out of this check just by omitting a field. `ABSENT CONSTRAINT WIDENS
    // SCOPE` — so a malformed declaration is an INSTRUMENT FAULT, not a quietly weaker join.
    if (typeof o.witness !== 'string' || o.witness.length === 0) {
      throw new Error(`INSTRUMENT FAULT: row ${row.id} declares owned expression ${JSON.stringify(o.expression)} with NO \`witness\` — the substitution check cannot run and no verdict from this row means anything`);
    }
    const first = body.indexOf(o.expression);
    if (first < 0) return { ok: false, why: `declared owned expression ${JSON.stringify(o.expression)} is ABSENT from the submitted body` };
    if (body.indexOf(o.expression, first + 1) !== -1) {
      return { ok: false, why: `declared owned expression ${JSON.stringify(o.expression)} is AMBIGUOUS (occurs more than once) — the span join would be a guess` };
    }
    anchors.push({ ...o, start: first, end: first + o.expression.length });
  }
  // 🛑 R-557 §1 — THE THIRD CLAUSE OF ITEM 14, WHICH THE FIRST VERSION DID NOT DELIVER.
  // Containment alone is not ownership. `AR-598 §3` measured that every anchor is WIDER than the
  // diagnostic it owns, and the desk CONSTRUCTED the consequence: renaming 34(d-u)'s parameter
  // `(lane: Lane)` -> `(ln: Lane)` lands a SECOND, unrelated `TS2304` on `lane` INSIDE the
  // declared anchor `undeclaredReader(lane)`. Both were credited; GATE: PASS; EXIT 0.
  //   AN ANCHOR WIDE ENOUGH TO BE FALSIFIABLE IS WIDE ENOUGH TO SHELTER AN IMPOSTOR.
  //
  // 🛑 THE REPAIR IS *NOT* TO NARROW THE ANCHOR TO THE DIAGNOSTIC'S SPAN (R-557 §4 makes that a
  // STOP, and it is right: an anchor equal to its own diagnostic restates the observation and can
  // never be wrong). The anchor stays exactly as wide as the OWNED EXPRESSION. What changes is
  // that the join must be a BIJECTION: every diagnostic joins EXACTLY ONE anchor, and every
  // anchor is joined by EXACTLY ONE diagnostic. A second diagnostic sheltering inside an anchor
  // has no anchor of its own left to claim, so it convicts the row instead of riding along.
  // A row that genuinely owns two diagnostics at one expression declares that expression TWICE —
  // the count is then a CLAIM the row makes and the run can falsify.
  const unjoined = [], ambiguous = [];
  const claimedBy = new Map();          // anchor index -> the diagnostic that claimed it
  const surplus = [], substituted = [];
  for (const d of records) {
    if (d.start === null) { unjoined.push(`${d.code}@<no span>`); continue; }
    // 🛑★★★★★ GRADE F-3 — THE BIJECTION COUNTS *SURPLUS* AND CANNOT SEE *SUBSTITUTION*.
    // MEASURED BEFORE THE FIX (AR-608 §2): declaring `undeclaredReader` so 34(d-u)'s TRUE plant
    // RESOLVES, while renaming its parameter so an unrelated TS2304 lands on `lane` INSIDE the
    // byte-unchanged anchor, gave ONE diagnostic for ONE anchor — bijection satisfied, `surplus`
    // and `unwitnessed` both empty, row credited CAUGHT_BY_TYPECHECKER, partition NUMERICALLY
    // IDENTICAL to clean, GATE: PASS, EXIT 0. The run even printed the smoking gun — `TS2304@L2:61
    // "lane"` — because the discriminator was in the record all along and the join never used it.
    //
    // 🛑 THE REPAIR IS *NOT* TO NARROW THE ANCHOR (R-557 §4 / R-570 §5 make that a STOP, and they
    // are right: an anchor equal to its own diagnostic restates the observation). CONTAINMENT IS
    // UNCHANGED and the anchor stays exactly as wide as the owned expression. What is added is a
    // SEPARATE, PRE-REGISTERED axis: the row declares IN THE CORPUS which text its diagnostic must
    // point at, and the run falsifies that claim. The row can be WRONG, which is what makes it a
    // check rather than a restatement — and because the corpus is pinned, the claim cannot be
    // edited to fit the observation after the fact.
    const contained = anchors
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.code === d.code && d.start >= a.start && d.start + d.length <= a.end);
    const cands = contained.filter(({ a }) => d.anchorText === a.witness);
    const shown = `${d.code}@${d.start}${d.anchorText === null ? '' : `:${JSON.stringify(d.anchorText)}`}`;
    if (contained.length > 0 && cands.length === 0) {
      const c = contained[0].a;
      substituted.push(`${shown} carries the declared code and lies INSIDE ${JSON.stringify(c.expression)}, but points at ${JSON.stringify(d.anchorText)} where this row declared witness ${JSON.stringify(c.witness)} — a SUBSTITUTED diagnostic, NOT this row's planted illegality`);
      continue;
    }
    if (cands.length === 0) { unjoined.push(shown); continue; }
    // Overlapping/nested declared expressions make ownership undecidable — fail closed rather
    // than pick one, which is the same discipline as the ambiguous-anchor check above.
    if (cands.length > 1) { ambiguous.push(`${shown} matches ${cands.length} declared anchors`); continue; }
    const { i } = cands[0];
    if (claimedBy.has(i)) {
      surplus.push(`${shown} is an EXTRA diagnostic sheltering inside ${JSON.stringify(anchors[i].expression)}, already owned by ${claimedBy.get(i)} — it is NOT entailed by this row's planted illegality`);
      continue;
    }
    claimedBy.set(i, shown);
  }
  const unwitnessed = anchors
    .map((a, i) => ({ a, i }))
    .filter(({ i }) => !claimedBy.has(i))
    .map(({ a }) => `${a.code}@${JSON.stringify(a.expression)}`);
  if (unjoined.length === 0 && ambiguous.length === 0 && surplus.length === 0
      && substituted.length === 0 && unwitnessed.length === 0) {
    return { ok: true, why: anchors.map((a) => `${a.code}@${JSON.stringify(a.expression)}:${JSON.stringify(a.witness)}`).join(' + ') };
  }
  return {
    ok: false,
    why: [
      substituted.length ? `SUBSTITUTED diagnostic(s): ${substituted.join(', ')}` : '',
      unjoined.length ? `diagnostic(s) NOT owned by this row: ${unjoined.join(', ')}` : '',
      surplus.length ? `EXTRA diagnostic(s) on an owned row: ${surplus.join(', ')}` : '',
      ambiguous.length ? `AMBIGUOUS ownership (overlapping declared anchors): ${ambiguous.join(', ')}` : '',
      unwitnessed.length ? `declared anchor(s) never witnessed: ${unwitnessed.join(', ')}` : '',
    ].filter(Boolean).join(' | '),
  };
}

function classifyTypeInvalid(records, row, body) {
  const codes = records.map((r) => r.code);
  // Surface FIRST: an unconfigured instrument can manufacture any of the others.
  if (codes.some((c) => SURFACE_CODES.includes(c))) return { status: 'SURFACE_INVALID', why: codes.join(' + ') };
  const own = ownershipJoin(records, row, body);
  if (own.ok) return { status: 'CAUGHT_BY_TYPECHECKER', why: own.why };
  // The join failed. The row is NOT credited. Which stopping bucket it lands in is chosen for
  // information, not for leniency — both fail the gate.
  if (codes.some((c) => FIXTURE_INVALID_CODES.includes(c))) return { status: 'FIXTURE_INVALID', why: `${own.why} [authoring codes: ${codes.join(' + ')}]` };
  return { status: 'TYPE_INVALID_UNCLASSIFIED', why: own.why };
}

// The duplicate-id injection plants a REAL duplicate row, so the id-uniqueness check runs on
// genuinely duplicated data rather than on a flipped flag.
//
// ---- ITEM 15's RED PATHS (R-548 red-proofs b, e, f, g) --------------------------------------
// Every one of these mutates the CORPUS UNDER TEST and NEVER the expected set. A mutation that
// edits the expectation cannot show the detector works — it IS the defect being guarded against.
const dup = (id) => ({ ...CORPUS.find((c) => c.id === id) });
function corpusUnderTest() {
  switch (INJECT) {
    case 'partition_overlap': return [...CORPUS, dup('38')];
    // (b) R-548 §2's attack B VERBATIM: a unique rename, body and expectation byte-untouched.
    //     Under the old self-authored set this produced `missing_ids: []` and exit 0.
    case 'membership_rename': return CORPUS.map((c) => (c.id === '35(a)' ? { ...c, id: '35(z)' } : c));
    // (e) an id arrives that is neither in the pinned 52 nor in the declared additions
    case 'membership_add': return [...CORPUS, { ...dup('38'), id: '99(x)' }];
    // (f) an expected id disappears
    case 'membership_delete': return CORPUS.filter((c) => c.id !== '38');
    // (g) the same id appears twice in the population under test
    case 'membership_duplicate': return [...CORPUS, dup('47')];
    // 🛑 R-558's REPRODUCER: delete guard row 56(a) — the `export * from './ledger.js'` guard that
    // exists BECAUSE the accuracy-validator's F-1 CRITICAL admitted a module reaching the ledger.
    // This exited 0 before the expanded pin: the row vanished, `declared_but_absent` printed it,
    // and nothing gated. The pinned 53e80935 still expects it, and no edit here can change that.
    case 'membership_delete_guard': return CORPUS.filter((c) => c.id !== '56(a)');
    // 🛑 R-561: the RED<->GREEN MIGRATION. The id still exists in the delivery — it just moved
    // populations. `atom`/`expect` are supplied only so the runner's loop can process the row;
    // the defect being tested is the DISPOSITION change, not this row's verdict.
    case 'green_to_red': return [...CORPUS, {
      ...GREEN.find((g) => g.id === 'G-src-implements-erased'),
      atom: 'RED<->GREEN migration probe', expect: '1b-S:module-system',
    }];
    default: return CORPUS;
  }
}
const CORPUS_UNDER_TEST = corpusUnderTest();

// R-556 §3: a planted-defect test owes a positive control that the plant LANDED, printed before
// the verdict. Populated by any injection that could silently fail to apply.
const PLANT_WITNESS = [];

const results = [];
for (const c of CORPUS_UNDER_TEST) {
  let outcome = 'REJECTED', fired = [], detail = '', tuple = null, diagnostics = [], submittedBody = null;
  let diagRecords = [], typeWhy = '';
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
    // PARTIAL ERASURE: one spelling used BOTH as an erased type and as a live value, which the
    // emitter oracle cannot attribute per occurrence -> fails closed.
    // ⚠️ THIS WITNESS HAS NOW BEEN RETIRED THREE TIMES BY UNRELATED REPAIRS — labeled statement
    // (killed by label handling), then enum member (killed by the emitter oracle), now this.
    // Each time the guard silently stopped guarding while the suite still read green.
    //   A RED PATH IS NOT A PROPERTY OF THE GUARD, IT IS A PROPERTY OF THE GUARD *AND* THE
    //   CURRENT CODE — so it is re-measured every run and never inherited from a past pass.
    if (INJECT === 'position_unclassified' && c.id === '35(b)') body = `export const project = (lane: Lane) => { const w: Widget = { w: 1 }; return { v: Widget(lane), q: w }; };\n`;
    if (INJECT === 'fixture_invalid' && c.id === '48') body = `const C = deepFreeze({ a: 1 }, 2);\nexport const project = (lane: Lane) => ({ v: C.a });\n`;
    if (INJECT === 'type_invalid_unclassified' && c.id === '48') body = `const C = Object.freeze({ a: 1 });\nexport const project = (lane: Lane) => ({ v: C.a === 'x' });\n`;
    // ---- ITEM 14's RED PATHS (R-548 red-proofs a, c, d) ----------------------------------
    // (a) R-548 §2's ATTACK A, VERBATIM: an UNRELATED authoring defect (TS2339) on row 35(a),
    //     which has nothing to do with 35(a)'s planted `globalThis` capture. Under the global
    //     code list this MOVED THE ROW INTO `caught_by_typechecker` (44->43, 5->6) and exited 0.
    if (INJECT === 'own_unrelated_attributed' && c.id === '35(a)') body = `const plantedFixtureRegression = ({}).missing;\n${c.body}`;
    // (c) the same species on a DIFFERENT non-owned row, with a different code (TS2304).
    if (INJECT === 'own_unrelated_nonowned' && c.id === '34(b)') body = `const q = undefinedIdentifierXyz;\n${c.body}`;
    // (d) an EXTRA diagnostic beside a LEGITIMATELY compiler-owned mutation. 52(a) really does
    //     own its TS1117; TS2304 was in the DELETED global allowlist, so the old rule kept the
    //     credit. The row-bound join must refuse the row while the plant is still there.
    if (INJECT === 'own_extra_code' && c.id === '52(a)') body = `const q = undefinedIdentifierXyz;\n${c.body}`;
    // 🛑 R-557 §1's REPRODUCER, VERBATIM AS THE DESK CONSTRUCTED IT — the founding defect of the
    // third clause, so it lives in the mutation set and not only in prose (R-547 §4.3).
    // Renaming the PARAMETER leaves the declared anchor `undeclaredReader(lane)` byte-unchanged
    // and still occurring exactly once, but lands a SECOND unrelated TS2304 on `lane` INSIDE it.
    // Before the bijection this exited 0 with BOTH diagnostics credited.
    // ⚠️ R-556 §3, applied rather than admired: this is the ONE injection here that mutates by
    // string REPLACE, and a replace whose anchor does not match applies NOTHING and yields a
    // green indistinguishable from a guard that did not fire. The desk was bitten by exactly
    // this shape. So the plant is VERIFIED TO HAVE LANDED, loudly, before any verdict is read.
    //   AN INJECTION THAT DID NOT LAND PRODUCES A GREEN INDISTINGUISHABLE FROM A GUARD THAT DID NOT FIRE.
    if (INJECT === 'own_extra_inside_anchor' && c.id === '34(d-u)') {
      body = c.body.replace('(lane: Lane)', '(ln: Lane)');
      if (body === c.body) throw new Error("INSTRUMENT FAULT: own_extra_inside_anchor planted NOTHING — '(lane: Lane)' did not match 34(d-u)'s body; any verdict from this run is void");
      PLANT_WITNESS.push(`34(d-u): '(lane: Lane)' -> '(ln: Lane)' (${c.body.length}B -> ${body.length}B), anchor 'undeclaredReader(lane)' left byte-unchanged`);
    }
    // 🛑★★★★★ GRADE F-3 — R-548's ATTACK A, THE *SUBSTITUTED* FORM. `own_extra_inside_anchor`
    // above leaves the true plant in place and adds a SECOND diagnostic, so the bijection sees a
    // SURPLUS and reddens. THIS injection instead makes the TRUE PLANT RESOLVE — `undeclaredReader`
    // is DECLARED — while the parameter rename lands an IMPOSTOR TS2304 on `lane` inside the
    // byte-unchanged anchor. ONE diagnostic, ONE anchor: the bijection is SATISFIED and, before the
    // witness check, this exited 0 with the partition numerically identical to clean.
    // ⚠️ The anchor text is asserted PRESENT AND UNCHANGED, because an injection that did not land
    // produces a green indistinguishable from a guard that did not fire (R-556 §3).
    if (INJECT === 'substituted_diagnostic' && c.id === '34(d-u)') {
      const renamed = c.body.replace('(lane: Lane)', '(ln: Lane)');
      if (renamed === c.body) throw new Error("INSTRUMENT FAULT: substituted_diagnostic planted NOTHING — '(lane: Lane)' did not match 34(d-u)'s body; any verdict from this run is void");
      body = `const undeclaredReader = (x: unknown) => x;\n${renamed}`;
      if (!body.includes('undeclaredReader(lane)')) throw new Error('INSTRUMENT FAULT: substituted_diagnostic did not preserve the declared anchor byte-for-byte; the attack would be testing the wrong thing');
      PLANT_WITNESS.push(`34(d-u) SUBSTITUTION: 'undeclaredReader' DECLARED so the TRUE plant resolves, '(lane: Lane)' -> '(ln: Lane)' so an IMPOSTOR TS2304 lands on 'lane' INSIDE the byte-unchanged anchor 'undeclaredReader(lane)'`);
    }
    submittedBody = body;
    const r = admitSource(c.file, body);
    outcome = r.outcome; tuple = r.tuple; diagnostics = r.diagnostics || []; diagRecords = r.diagnosticRecords || [];
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
  else if (outcome === 'TYPE_INVALID') {
    const cl = classifyTypeInvalid(diagRecords, c, submittedBody ?? '');
    status = cl.status; typeWhy = cl.why;
  }
  else if (uniqFired.includes('POSITION_UNCLASSIFIED')) status = 'POSITION_UNCLASSIFIED';
  else if (c.expect === NOT_IMPLEMENTED) status = 'MISS_NOT_IMPLEMENTED';
  else if (uniqFired.includes(c.expect) && competing.length === 0) status = 'ATTRIBUTED';
  else if (uniqFired.includes(c.expect)) status = 'FAILED_OWNERSHIP';   // named fired, but not alone
  else if (uniqFired.length > 0) status = 'FAILED_WRONG_CATCHER';
  else status = 'MISS_NOT_CAUGHT';
  results.push({ id: c.id, atom: c.atom, expect: c.expect, file: c.file, fired: uniqFired, competing, status, detail, tuple, diagnostics, diagRecords, typeWhy, submittedBody });
}

// ---- GREEN neighbours must be ADMITTED ----
// 🛑 R-561's RED PATHS. These mutate the GREEN population UNDER TEST, never the frozen pin.
// The decisive fixture is `G-src-implements-erased`: it exists BECAUSE R-551 §2 proved the rule
// convicted erased code, and deleting it previously gave `7 / 7`, GATE: PASS, EXIT 0.
const GREEN_UNDER_TEST = (() => {
  switch (INJECT) {
    case 'green_delete': return GREEN.filter((g) => g.id !== 'G-src-implements-erased');
    case 'green_add': return [...GREEN, { ...GREEN.find((g) => g.id === 'G-src-clean'), id: 'G-src-undeclared' }];
    case 'green_duplicate': return [...GREEN, { ...GREEN.find((g) => g.id === 'G-src-clean') }];
    // RED<->GREEN migration: the row still EXISTS, so any check asking only "does this id exist
    // somewhere" waves it through. Its DISPOSITION changed, and disposition is the contract.
    case 'green_to_red': return GREEN.filter((g) => g.id !== 'G-src-implements-erased');
    default: return GREEN;
  }
})();
const greens = GREEN_UNDER_TEST.map((g) => {
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
// ---- ITEM 15: THE MEMBERSHIP JOIN, AGAINST THE PINNED ARTIFACT ------------------------
// Both directions and uniqueness. A rename fires on BOTH halves at once — the old id goes
// MISSING and the new id arrives UNDECLARED — which is exactly what the self-authored set
// could never do.
const membership = checkMembership(CORPUS_UNDER_TEST);
// R-561: the GREEN population gets the SAME treatment — both directions, uniqueness, and the
// disposition contract. `green_admitted === green_total` is retained but is no longer the only
// green assertion, because it can only ever speak about the members that survived.
const greenMembership = checkGreenMembership(GREEN_UNDER_TEST, CORPUS_UNDER_TEST);

// ---- R-562: THE CLASS SWEEP -----------------------------------------------------------
// The remaining self-authored collections, and the SET OF COLLECTION NAMES itself. The
// injections mutate the LIVE VIEW handed to the checker, never the frozen pin.
const liveCollections = {
  TWIN_PAIRS: INJECT === 'twin_pairs_delete' ? TWIN_PAIRS.slice(0, -1) : TWIN_PAIRS,
  PREREGISTERED_EMIT_CHANGES: INJECT === 'prereg_delete'
    ? Object.fromEntries(Object.entries(corpusModule.PREREGISTERED_EMIT_CHANGES).slice(0, -1))
    : corpusModule.PREREGISTERED_EMIT_CHANGES,
  // A NEW exported collection nobody pinned is itself the finding — that is what closes the class
  // rather than closing instance four.
  collectionNames: INJECT === 'new_unpinned_collection'
    ? collectionNamesOf({ ...corpusModule, ROGUE_SELF_CERTIFYING_SET: ['x'] })
    : collectionNamesOf(corpusModule),
};
const aux = checkAuxiliaryCollections(liveCollections);
// `.filter(Boolean)` because a MISSING expected row must be REPORTED by the membership check,
// not crash the tally before the check is ever printed.
const orig = EXPECTED_ORIGINAL_IDS.map((id) => results.find((r) => r.id === id)).filter(Boolean);
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
  // ITEM 15: these come from the PINNED artifact join, not from the corpus asking itself.
  expected_membership_source: `${BASELINE_META.commit}:corpus.mjs blob ${BASELINE_META.blob.slice(0, 12)} (${BASELINE_META.rawBytes}B, ${BASELINE_META.substitutions} declared import substitutions)`,
  expected_cardinality: membership.expected_count,
  // R-558: the expanded population is now pinned too, and its absences GATE.
  expanded_membership_source: `${EXPANDED_META.commit}:corpus.mjs blob ${EXPANDED_META.blob.slice(0, 12)} (${EXPANDED_META.rawBytes}B)`,
  expected_expanded_cardinality: membership.expected_expanded_count,
  missing_ids: membership.missing,
  missing_expanded_ids: membership.missing_expanded,
  undeclared_ids: membership.undeclared,
  duplicate_ids: membership.duplicated,
  derived_additions_absent: membership.derived_additions_absent,
};

// A miss must show WHY it missed, or the table hides the very thing it is reporting.
// ---- F-7 (GRADE-P0PC-PARTITION, fix point `run.mjs:218`) — FIXED AT THE EMITTER ---------
// This special-cased `MISS_TYPE_INVALID`, a status R-546 §5.0 RETIRED and which is never
// assigned again — so it matched nothing, and the CAUGHT_BY_TYPECHECKER rows (the only rows
// whose population depends ENTIRELY on their diagnostics) fell through to `r.fired`, which is
// empty for a TYPE_INVALID outcome. The table printed `<none fired>` for exactly the rows a
// reader most needs to check. Now that item 14 makes the (code, SPAN) join load-bearing, this
// is not cosmetic: the anchor is the evidence, so the anchor gets printed.
const why = (r) => {
  if (r.status === 'ATTRIBUTED') return r.expect;
  if (r.diagRecords && r.diagRecords.length) {
    return r.diagRecords
      .map((d) => `${d.code}@L${d.line}:${d.character}${d.anchorText === null ? '' : ` ${JSON.stringify(d.anchorText)}`}`)
      .join(' + ');
  }
  return r.fired.join(',') || '<none fired>';
};
const line = (r) => `${r.id.padEnd(9)} ${r.status.padEnd(22)} ${r.atom.slice(0, 40).padEnd(40)} ${why(r)}`;
console.log('P0-vNext ADMISSION PROTOTYPE — COVERAGE RUN');
console.log(`PINNED SURFACE: ${SURFACE_DIR}`);
console.log(`EFFECTIVE-MODULE TUPLE (reference, fixture.ts): ${JSON.stringify(effectiveModuleTuple(`${SURFACE_DIR}/fixture.ts`))}`);
console.log('='.repeat(116));
for (const r of results) console.log(line(r));
console.log('='.repeat(116));
// R-556 §3: the plant witness prints BEFORE the verdict, so a no-op injection is visible as a
// no-op rather than reading as a clean run.
if (PLANT_WITNESS.length) for (const w of PLANT_WITNESS) console.log(`PLANT LANDED (positive control): ${w}`);
// ---- ITEM 14 + F-7: THE OWNERSHIP JOIN, PRINTED SO IT CAN BE AUDITED FROM THIS OUTPUT ----
// The runner's own table could not previously be audited from its own output. Every TYPE_INVALID
// row now shows the diagnostics it produced, the anchors its row DECLARED, and the join verdict.
const typeInvalidRows = results.filter((r) => r.diagRecords && r.diagRecords.length);
console.log(`TYPE-CHECKER OWNERSHIP JOIN (item 14) — key is (row, owned expression, span, expected defect):`);
if (typeInvalidRows.length === 0) console.log('  <no row produced a semantic diagnostic in this run>');
for (const r of typeInvalidRows) {
  const decl = (CORPUS_UNDER_TEST.find((c) => c.id === r.id) || {}).typecheckerOwned;
  console.log(`  ${r.id.padEnd(9)} ${r.status.padEnd(24)} declared=${decl ? decl.map((o) => `${o.code}@${JSON.stringify(o.expression)}`).join(' + ') : '<NONE>'}`);
  for (const d of r.diagRecords) console.log(`${' '.repeat(14)}saw ${d.code} @L${d.line}:${d.character} span[${d.start},${d.start + d.length}) ${JSON.stringify(d.anchorText)}`);
  console.log(`${' '.repeat(14)}JOIN: ${r.typeWhy}`);
}
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
  ['fixture_invalid', results.some((r) => r.status === 'FIXTURE_INVALID'), () => `${results.filter((r) => r.status === 'FIXTURE_INVALID').map((r) => `${r.id} [${r.diagnostics.join(';')}] OWNERSHIP: ${r.typeWhy}`).join(' | ')}`],
  // ITEM 14: this is the bucket a FAILED row-bound ownership join lands in, and the message
  // now names the join failure rather than only the codes — the codes are what misled before.
  ['type_invalid_unclassified', results.some((r) => r.status === 'TYPE_INVALID_UNCLASSIFIED'), () => `${results.filter((r) => r.status === 'TYPE_INVALID_UNCLASSIFIED').map((r) => `${r.id} [${r.diagnostics.join(';')}] OWNERSHIP: ${r.typeWhy}`).join(' | ')}`],
  // ---- ITEM 15: MEMBERSHIP AGAINST THE PINNED ARTIFACT, BOTH DIRECTIONS + UNIQUENESS ----
  // The old self-authored set made this class unreachable by construction: a rename changed the
  // expectation and the actual together, so `missing_ids` was always `[]`.
  // 🛑 R-558: `missing_expanded` JOINS THE GATE. Deleting guard row 56(a) — the guard that exists
  // for the accuracy-validator's F-1 CRITICAL — previously left GATE: PASS, EXIT 0, because the
  // expanded population was policed by a mutable array in the same delivery and nothing gated it.
  ['membership', membership.missing.length > 0 || membership.missing_expanded.length > 0
    || membership.undeclared.length > 0 || membership.duplicated.length > 0,
    () => [
      membership.missing.length ? `MISSING from the pinned 52 (expected by ${BASELINE_META.commit}): ${membership.missing.join(', ')}` : '',
      membership.missing_expanded.length ? `MISSING from the pinned EXPANDED corpus (expected by ${EXPANDED_META.commit}): ${membership.missing_expanded.join(', ')}` : '',
      membership.undeclared.length ? `UNDECLARED arrivals (not in the pinned expanded set ${EXPANDED_META.commit} — legitimate growth must BUMP THE PIN): ${membership.undeclared.join(', ')}` : '',
      membership.duplicated.length ? `DUPLICATE ids in the population under test: ${membership.duplicated.join(', ')}` : '',
    ].filter(Boolean).join(' | ')],
  // 🛑 R-561: the GREEN population, pinned and gated exactly as the red one is.
  ['green_membership', greenMembership.missing.length > 0 || greenMembership.undeclared.length > 0
    || greenMembership.duplicated.length > 0,
    () => [
      greenMembership.missing.length ? `MISSING green control(s) (expected by ${EXPANDED_META.commit}): ${greenMembership.missing.join(', ')}` : '',
      greenMembership.undeclared.length ? `UNDECLARED green arrival(s) (not in the pinned green set): ${greenMembership.undeclared.join(', ')}` : '',
      greenMembership.duplicated.length ? `DUPLICATE green ids: ${greenMembership.duplicated.join(', ')}` : '',
    ].filter(Boolean).join(' | ')],
  // 🛑 R-561: DISPOSITION IS PART OF THE CONTRACT. A row that merely MOVED between populations
  // still exists, so an existence-only check would wave it through — this one will not.
  ['disposition', greenMembership.green_found_in_corpus.length > 0 || greenMembership.red_found_in_green.length > 0,
    () => [
      greenMembership.green_found_in_corpus.length ? `id(s) pinned GREEN found among the RED rows: ${greenMembership.green_found_in_corpus.join(', ')}` : '',
      greenMembership.red_found_in_green.length ? `id(s) pinned RED found among the GREEN rows: ${greenMembership.red_found_in_green.join(', ')}` : '',
    ].filter(Boolean).join(' | ')],
  // 🛑 R-562: TWIN_PAIRS. Deleting an entry leaves both rows it names ALIVE, so every membership
  // and disposition check passes while the twin assertions silently go 2 -> 1.
  //   THE CHECK IS REMOVED RATHER THAN FAILED — which no count of surviving members can detect.
  ['twin_pairs_membership', aux.twin_missing.length > 0 || aux.twin_undeclared.length > 0 || aux.twin_duplicated.length > 0,
    () => [
      aux.twin_missing.length ? `MISSING twin pair(s) (expected by ${EXPANDED_META.commit}): ${aux.twin_missing.join(', ')}` : '',
      aux.twin_undeclared.length ? `UNDECLARED twin pair(s): ${aux.twin_undeclared.join(', ')}` : '',
      aux.twin_duplicated.length ? `DUPLICATE twin pair(s): ${aux.twin_duplicated.join(', ')}` : '',
    ].filter(Boolean).join(' | ')],
  // 🛑 R-562: PREREGISTERED_EMIT_CHANGES, consumed by emitted-freeze.mjs. Dropping a key for an
  // EMIT-IDENTICAL row is invisible to that gate, so the key set is pinned here.
  ['prereg_membership', aux.prereg_missing.length > 0 || aux.prereg_undeclared.length > 0,
    () => [
      aux.prereg_missing.length ? `MISSING pre-registration key(s) (expected by ${EXPANDED_META.commit}): ${aux.prereg_missing.join(', ')}` : '',
      aux.prereg_undeclared.length ? `UNDECLARED pre-registration key(s): ${aux.prereg_undeclared.join(', ')}` : '',
    ].filter(Boolean).join(' | ')],
  // 🛑★★★★★ R-562 item 3 — THE SET OF SETS. This is what closes the CLASS instead of instance
  // four: a NEW exported collection that nobody pinned is itself a finding, so instance five
  // announces itself rather than waiting to be discovered by hand.
  ['collection_shape', aux.collection_missing.length > 0 || aux.collection_undeclared.length > 0,
    () => [
      aux.collection_missing.length ? `exported collection(s) REMOVED from corpus.mjs (expected by ${EXPANDED_META.commit}): ${aux.collection_missing.join(', ')}` : '',
      aux.collection_undeclared.length ? `NEW UNPINNED exported collection(s) — pin it or declare it EXEMPT in code (R-562): ${aux.collection_undeclared.join(', ')}` : '',
    ].filter(Boolean).join(' | ')],
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
