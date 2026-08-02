// ITEM 10's RED-PROOF (R-546 §5.10). The order was a PROPERTY, not a mechanism:
//
//   AN IDENTIFIER ERASED BEFORE EXECUTION CANNOT BE RUNTIME-CAPTURE EVIDENCE.
//
// R-546 §2 measured that on the previous build the SAME spelling in type-only and value-only
// position returned the IDENTICAL verdict — so the rule had no type/value discriminator at
// all. What it actually keyed on was DECLARATION LOCALITY, which is why an
// externally-declared `Lane` annotation was reported as a runtime free reference.
//
// `Widget` is declared in BOTH spaces in the committed surface, so D and E differ in NOTHING
// except the position of the identifier. That is the whole discriminator. If the pair were
// built on an UNDECLARED spelling it would die at TS2304 before any catcher ran and would
// prove nothing — which is exactly what my first attempt at this probe did.
//
// NO SPELLING ALLOWLIST EXISTS OR MAY EXIST: `Widget` is treated by position, never by name.
import { admitSource } from './source-admission.mjs';

const P = (body) => admitSource('probe.ts', body);
const catchers = (r) => r.violations.map((v) => v.catcher);
const freeRefsOn = (r, name) => r.violations.filter((v) => v.catcher === '1b-S:free-captured-reference' && v.path.includes(`'${name}'`)).length;

const CASES = [
  // ---- THE D/E PAIR: one spelling, two positions, nothing else different ----
  { id: 'D', label: 'Widget in TYPE-ONLY position', kind: 'pair',
    body: `type Alias = Widget;\nexport const project = (lane: Lane) => ({ v: lane.v } as unknown as Alias);\n`,
    assert: (r) => ({ ok: r.outcome === 'ADMITTED' && freeRefsOn(r, 'Widget') === 0, want: 'ADMITTED, SILENT on Widget' }) },
  { id: 'E', label: 'Widget in VALUE-ONLY position', kind: 'pair',
    body: `export const project = (lane: Lane) => ({ v: Widget(lane) });\n`,
    assert: (r) => ({ ok: r.outcome === 'REJECTED' && freeRefsOn(r, 'Widget') === 1 && new Set(catchers(r)).size === 1, want: 'REJECTED, EXCLUSIVELY FREE_REF on Widget' }) },

  // ---- R-546 §2's other measured rows ----
  { id: 'R1', label: 'resolved ambient TYPE in annotation', kind: 'regression',
    body: `export const project = (lane: Lane) => ({ v: lane.v });\n`,
    assert: (r) => ({ ok: r.outcome === 'ADMITTED', want: 'ADMITTED (Lane is type-only)' }) },
  { id: 'R2', label: 'ambient type + the INTENDED witness', kind: 'regression',
    body: `export const project = (lane: Lane) => ({ v: injectedReader(lane) });\n`,
    assert: (r) => ({ ok: freeRefsOn(r, 'injectedReader') === 1 && freeRefsOn(r, 'Lane') === 0 && new Set(catchers(r)).size === 1,
      want: 'FREE_REF on injectedReader ONLY — the witness is isolable within its own catcher' }) },
  { id: 'G', label: 'as-cast to an external type', kind: 'regression',
    body: `export const project = (lane: Lane) => ({ v: lane.v } as unknown as Widget);\n`,
    assert: (r) => ({ ok: r.outcome === 'ADMITTED', want: 'ADMITTED' }) },

  // ---- the remaining erased positions item 10 names ----
  { id: 'T1', label: 'type-only import specifier', kind: 'coverage',
    body: `import type { Addend } from './pure-math.js';\nexport const project = (lane: Lane) => ({ v: lane.v } as unknown as Addend);\n`,
    assert: (r) => ({ ok: freeRefsOn(r, 'Addend') === 0, want: 'no FREE_REF on Addend (type-only import is erased)' }) },
  { id: 'T2', label: 'satisfies operand', kind: 'coverage',
    body: `export const project = (lane: Lane) => (({ v: lane.v }) satisfies Record<string, unknown>);\n`,
    assert: (r) => ({ ok: r.outcome === 'ADMITTED', want: 'ADMITTED (Record is type-space)' }) },
  { id: 'T3', label: 'type ARGUMENT', kind: 'coverage',
    body: `export const project = (lane: Lane) => ({ v: (lane as unknown as Array<Widget>).length });\n`,
    assert: (r) => ({ ok: freeRefsOn(r, 'Widget') === 0, want: 'no FREE_REF on Widget (type argument is erased)' }) },
  { id: 'T4', label: 'interface / type alias body', kind: 'coverage',
    body: `interface Shape { readonly w: Widget }\nexport const project = (lane: Lane) => ({ v: lane.v } as unknown as Shape);\n`,
    assert: (r) => ({ ok: freeRefsOn(r, 'Widget') === 0, want: 'no FREE_REF on Widget (interface body is erased)' }) },

  // ---- CONTROLS: the suite must be able to say ADMITTED and REJECTED ----
  { id: 'B', label: 'CONTROL inline structural type', kind: 'control',
    body: `export const project = (lane: { v: unknown }) => ({ v: lane.v });\n`,
    assert: (r) => ({ ok: r.outcome === 'ADMITTED', want: 'ADMITTED' }) },
  { id: 'F', label: 'CONTROL local type alias', kind: 'control',
    body: `type L = { v: unknown };\nexport const project = (lane: L) => ({ v: lane.v });\n`,
    assert: (r) => ({ ok: r.outcome === 'ADMITTED', want: 'ADMITTED' }) },
  { id: 'C', label: 'CONTROL value-position free ref STILL CAUGHT', kind: 'control',
    body: `export const project = (lane: Lane) => ({ v: injectedReader(lane) });\n`,
    assert: (r) => ({ ok: r.outcome === 'REJECTED' && freeRefsOn(r, 'injectedReader') === 1,
      want: 'REJECTED — the fix must not have blinded the catcher' }) },
];

console.log('TYPE / VALUE SEPARATION — RED-PROOF (item 10)');
console.log('='.repeat(112));
let pass = 0;
const rows = [];
for (const c of CASES) {
  const r = P(c.body);
  const { ok, want } = c.assert(r);
  if (ok) pass += 1;
  rows.push({ ...c, ok, r });
  console.log(`${ok ? 'PASS' : '*** FAIL'} ${c.id.padEnd(3)} ${c.label.padEnd(38)} ${String(r.outcome).padEnd(12)} [${catchers(r).join(',') || '-'}]`);
  if (!ok) console.log(`         expected: ${want}`);
}

// ---- THE PAIR IS THE PROPERTY: state it as one claim, not two rows ----
const D = rows.find((x) => x.id === 'D'), E = rows.find((x) => x.id === 'E');
const sameSpelling = /Widget/.test(D.body) && /Widget/.test(E.body);
const propertyHolds = D.ok && E.ok && sameSpelling;
console.log('='.repeat(112));
console.log(`THE D/E PROPERTY — one spelling, two positions, nothing else different: ${propertyHolds ? 'HOLDS' : '*** DOES NOT HOLD ***'}`);
console.log(`  D (type-only)  -> ${D.r.outcome}, FREE_REF on Widget = ${freeRefsOn(D.r, 'Widget')}`);
console.log(`  E (value-only) -> ${E.r.outcome}, FREE_REF on Widget = ${freeRefsOn(E.r, 'Widget')}`);
console.log(`  same spelling in both arms: ${sameSpelling}   <- without this the pair proves nothing`);

// ---- THE RESIDUAL MUST BE REACHABLE, or "fails closed" is an untested branch ----
// A negative assertion needs a positive witness that the path RAN.
import { classifyPosition, POSITION_UNCLASSIFIED } from './source-admission.mjs';
const residualWitness = (() => {
  // A LabeledStatement's label is an Identifier in neither type nor value space.
  const r = P(`outer: for (const x of [1]) { break outer; }\nexport const project = (lane: Lane) => ({ v: lane.v });\n`);
  return { fired: r.violations.some((v) => v.catcher === POSITION_UNCLASSIFIED), detail: r.violations.map((v) => `${v.catcher}`).join(',') };
})();
console.log(`RESIDUAL REACHABLE (POSITION_UNCLASSIFIED can actually fire): ${residualWitness.fired} [${residualWitness.detail || '-'}]`);
console.log(`  ^ a fail-closed branch nothing can reach is a branch nobody has tested.`);

console.log('='.repeat(112));
const allOk = pass === CASES.length && propertyHolds;
console.log(`${pass} / ${CASES.length} cases pass | property ${propertyHolds ? 'HOLDS' : 'FAILS'}`);
console.log(allOk ? 'VERDICT: type-space / value-space separation is a PROPERTY of this rule.'
                  : 'VERDICT: NOT separated. Failing ids: ' + rows.filter((x) => !x.ok).map((x) => x.id).join(', '));
process.exitCode = allOk ? 0 : 1;
