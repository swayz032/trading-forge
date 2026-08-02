// SAFETY NOTE (for automated scanners and for readers): the strings below contain the
// tokens `eval`, `new Function`, `require` and `import()` because this corpus exists to
// prove those constructs are REJECTED. They are INERT FIXTURE TEXT: every `body` is handed
// to the TypeScript *parser* as a string and is never evaluated, required, or executed.
// Nothing here is interpolated from an untrusted source; the only interpolation is a
// backslash constant used so unicode-escape fixtures survive authoring.
//
// The executable corpus: every manifest subcase as a PLANTED fixture with the catcher
// the DESIGN names for it. Expected catchers are transcribed from the design's manifest,
// NOT from what the prototype happens to do -- so a row reddening via the wrong rule is
// reported FAILED, per `A MUTATION CAUGHT BY THE WRONG CHECK IS A FAILED PROOF`.
//
// ============================ WHAT CHANGED UNDER R-543/R-544 ============================
// Every source fixture now carries `(lane: Lane)`. THIS IS A DELIBERATE BYTE CHANGE and it
// is reported rather than made quietly: `strict: true` implies `noImplicitAny`, so the
// UNANNOTATED form was TS7006 and, under R-543 s4 item 1, 41 of 41 source fixtures --
// INCLUDING BOTH GREEN NEIGHBOURS -- were TYPE-INVALID. That would have driven coverage to
// zero and it would have been the SURFACE being wrong, not the corpus. `Lane` is declared
// in the committed surface (surface/ambient.d.ts).
//
// A second class of byte change, listed per row below: where a fixture's INCIDENTAL type
// error was not the channel under test, the use site was adjusted and the DEFECT LEFT
// INTACT. Where the type error IS entailed by the defect, the fixture was NOT rescued and
// the row is an honest `miss_type_invalid`. The rule is stated once and applied uniformly:
// NEVER edit a fixture in the direction that removes the thing it exists to prove.
import { CATCHERS as S } from './source-admission.mjs';
import { CATCHERS as R } from './runtime-admission.mjs';

const B = String.fromCharCode(92); // backslash, so escape fixtures survive authoring

// A catcher the design names but the prototype does not implement.
export const NOT_IMPLEMENTED = '1b-S:dependency-boundary';

// `file` selects the CONTAINER (extension). It is a first-class corpus input now, because
// the module system is decided by the container, not by the source text (R-544 s3 item 6).
const src = (body, file = 'fixture.ts') => ({ kind: 'source', body, file });
const val = (factory) => ({ kind: 'runtime', factory });

// ---- item 7: THE TRUE TWIN. ONE source text, used verbatim in BOTH arms. ---------------
// R-544 convicted the previous row 54: its "ESM twin" was the red WITH ONE LINE DELETED,
// which is the mutation run backwards, not a control. This text is byte-identical across
// the two arms and the ONLY difference between them is the file extension.
export const CONTAINER_TWIN_TS =
  `const HOLDER = Object.freeze({ slot: Object.freeze({}) });\nexport const project = (lane: Lane) => ({ v: lane.v, h: HOLDER.slot });\n`;
// The same idea in a JS container, JSDoc-typed so `checkJs` is satisfied without changing
// the program. R-544 s3 item 6 requires a `.cjs` REJECTED and a `.mjs` ADMITTED on this axis.
export const CONTAINER_TWIN_JS =
  `/** @type {(lane: Lane) => { v: unknown }} */\nexport const project = (lane) => ({ v: lane.v });\n`;

export const CORPUS = [
  // ---------- 1b-S : source ----------
  // 26(*): relative specifiers carry an explicit `.js` extension because the pinned surface
  // resolves under NodeNext. Without it these were TS2792 and could not be credited.
  { id: '26(a)', atom: 'unallowlisted import', expect: NOT_IMPLEMENTED,
    ...src(`import { read } from './ledger.js';\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  { id: '26(b)', atom: 'filesystem / network module', expect: NOT_IMPLEMENTED,
    ...src(`import fs from 'node:fs';\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  { id: '26(c)', atom: 'transitive edge to either', expect: NOT_IMPLEMENTED,
    ...src(`import './helper.js';\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },

  // 34(a)/(c): HOLDER carries an explicit MUTABLE annotation. `Object.freeze` types its
  // result `Readonly<T>`, so the setter body was TS2540 -- an incidental type error, not the
  // channel. The setter export IS the defect and it is untouched.
  { id: '34(a)', atom: 'setter / configuration export', expect: S.EXPORTS,
    ...src(`const HOLDER: { slot: unknown } = Object.freeze({ slot: Object.freeze({}) });\nexport const configure = (f: unknown) => { HOLDER.slot = f; };\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  { id: '34(b)', atom: 'function-valued export != project', expect: S.EXPORTS,
    ...src(`export const getLedger = () => 1;\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  { id: '34(c)', atom: 'export that mutates module state', expect: S.EXPORTS,
    ...src(`const H: { a: number } = Object.freeze({ a: 1 });\nexport const reset = () => { H.a = 2; };\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },

  // ---- THE 34(d) SPLIT (AR-590 s2a, flagged before the build) ---------------------------
  // The channel is "a free reference reaches out of the module". It has TWO forms and they
  // cannot both be type-valid:
  //   (d)            DECLARED elsewhere -> type-valid, still a free capture. COUNTED.
  //   (d-unresolved) UNDECLARED         -> TS2304 BY CONSTRUCTION. HONEST MISS, NOT COUNTED.
  // The unresolved form is the one that found the real bug in this rule on run one (the
  // check required checker.getSymbolAtLocation() and an unresolved identifier has none).
  // It is retained in full rather than deleted, because deleting it would erase the corpus's
  // single most valuable result to make a number look better.
  { id: '34(d)', atom: 'free / captured reference (declared)', expect: S.FREE_REF,
    ...src(`export const project = (lane: Lane) => ({ v: injectedReader(lane) });\n`) },
  // ⚠️ ITEM 14 CONVICTED THIS ROW ON ITS FIRST CLEAN RUN, AND I DID NOT PLANT THAT. Under the
  // deleted global code list, `TS2304` credited ANY row emitting it — so this row was carrying a
  // `caught_by_typechecker` credit that had never been joined to anything. The row-bound join
  // has no such list, so it failed closed and named the row. That is the guard working on its
  // first execution against code nobody was attacking.
  // ADJUDICATION OWED BY R-546 §5.12 ("re-examine whether the unresolved specimen is better
  // classified caught_by_typechecker — your call, state which and why"), ANSWERED HERE:
  // it IS `caught_by_typechecker` under R-546 §5.0(iii) — the planted illegality is a free
  // reference to an UNDECLARED name, and `TS2304 Cannot find name` is that illegality itself,
  // not an incidental error beside it. The row's own comment above already said "TS2304 BY
  // CONSTRUCTION"; the CODE said it via a global list, which is not the same claim.
  // `[MEASURED]` anchor: TS2304 @45+16 on `undeclaredReader`, inside the declared expression.
  // ⚠️ This row is a DECLARED ADDITION, not one of AR-589's 52, so this changes no published
  // like-for-like figure — re-measured below rather than asserted.
  { id: '34(d-u)', atom: 'free reference to an UNDECLARED name', expect: S.FREE_REF,
    typecheckerOwned: [{ code: 'TS2304', expression: 'undeclaredReader(lane)', defect: 'the planted illegality IS the unresolved free reference; an undeclared name is TS2304 by construction' }],
    ...src(`export const project = (lane: Lane) => ({ v: undeclaredReader(lane) });\n`) },

  { id: '35(a)', atom: 'globalThis', expect: S.AMBIENT,
    ...src(`export const project = (lane: Lane) => ({ v: globalThis.__ledger });\n`) },
  { id: '35(b)', atom: 'window', expect: S.AMBIENT,
    ...src(`export const project = (lane: Lane) => ({ v: window.__ledger });\n`) },
  { id: '35(c)', atom: 'global (alias of globalThis)', expect: S.AMBIENT,
    ...src(`export const project = (lane: Lane) => ({ v: global.__ledger });\n`) },
  { id: '35(d)', atom: 'ANY unallowlisted host-global', expect: S.AMBIENT,
    ...src(`export const project = (lane: Lane) => ({ v: Reflect.ownKeys(lane) });\n`) },
  { id: '36',    atom: 'process / process.env', expect: S.AMBIENT,
    ...src(`export const project = (lane: Lane) => ({ v: process.env.LEDGER_PATH });\n`) },
  { id: '37(a)', atom: 'mutable module-scope binding', expect: S.MODULE_STATE,
    ...src(`let cache: unknown = null;\nexport const project = (lane: Lane) => ({ v: cache });\n`) },
  { id: '37(b)', atom: 'cache populated on first call', expect: S.MODULE_STATE,
    ...src(`var c = 0;\nexport const project = (lane: Lane) => ({ v: c });\n`) },
  { id: '37(c)', atom: 'singleton', expect: S.MODULE_STATE,
    ...src(`let S = { n: 1 };\nexport const project = (lane: Lane) => ({ v: S.n });\n`) },
  { id: '37(d)', atom: 'lazily-initialised holder', expect: S.MODULE_STATE,
    ...src(`let H: unknown;\nexport const project = (lane: Lane) => ({ v: H });\n`) },
  { id: '38',    atom: 'SHALLOW-frozen nested holder', expect: S.GRAMMAR,
    ...src(`const HOLDER = Object.freeze({ slot: {} });\nexport const project = (lane: Lane) => ({ v: HOLDER.slot });\n`) },
  { id: '41(a)', atom: 'import()', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = async (lane: Lane) => ({ v: await import('./ledger.js') });\n`) },
  { id: '41(b)', atom: 'require, computed specifier', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane: Lane) => ({ v: require('./' + lane.n) });\n`) },
  { id: '41(c)', atom: 'eval', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane: Lane) => ({ v: eval('1+1') });\n`) },
  { id: '41(d)', atom: 'new Function', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane: Lane) => ({ v: new Function('return 1')() });\n`) },
  { id: '41(e)', atom: 'createRequire', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane: Lane) => ({ v: createRequire('x') });\n`) },
  { id: '48',    atom: 'helper-returned module constant', expect: S.GRAMMAR,
    ...src(`const C = deepFreeze({ a: 1 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '49(a)', atom: 'spread escape', expect: S.GRAMMAR,
    ...src(`const base = Object.freeze({ a: 1 });\nconst C = Object.freeze({ ...base });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '49(b)', atom: 'bare alias', expect: S.GRAMMAR,
    ...src(`const base = Object.freeze({ a: 1 });\nconst C = base;\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '49(c)', atom: 'computed key', expect: S.GRAMMAR,
    ...src(`const k = 'a';\nconst C = Object.freeze({ [k]: 1 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  // 50(a)/(b): the local freeze impostor is now generic so its return type is not `any`/
  // `unknown`. The impostor IS the defect and it is untouched -- only its signature is typed.
  { id: '50(a)', atom: 'shadowed / local freeze callee', expect: S.GRAMMAR,
    ...src(`const Object2 = { freeze: <T>(x: T): T => x };\nconst C = Object2.freeze({ slot: {} });\nexport const project = (lane: Lane) => ({ v: C.slot });\n`) },
  { id: '50(b)', atom: 'locally-declared freeze', expect: S.GRAMMAR,
    ...src(`const freeze = <T>(x: T): T => x;\nconst C = freeze({ slot: {} });\nexport const project = (lane: Lane) => ({ v: C.slot });\n`) },
  { id: '50(c)', atom: 'aliased freeze binding', expect: S.GRAMMAR,
    ...src(`const f = Object.freeze;\nconst C = f({ slot: {} });\nexport const project = (lane: Lane) => ({ v: C.slot });\n`) },
  // 51(*): the use site reads `C` rather than `C.x`. TypeScript's type view does not model
  // `__proto__`'s RUNTIME prototype-setting effect, so it typed `C` without the inherited
  // member and `C.x` was TS2339 -- an incidental type error. The `__proto__` KEY, which is
  // the entire channel, is untouched in all four subcases.
  { id: '51(a)', atom: '__proto__ key (raw Ident)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ __proto__: P });\nexport const project = (lane: Lane) => ({ v: C });\n`) },
  { id: '51(b)', atom: '__proto__ key (raw StringLit)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ "__proto__": P });\nexport const project = (lane: Lane) => ({ v: C });\n`) },
  { id: '51(c)', atom: '__proto__ key (escaped identifier)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ ${B}u005f${B}u005fproto__: P });\nexport const project = (lane: Lane) => ({ v: C });\n`) },
  { id: '51(d)', atom: '__proto__ key (escaped string)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ "${B}x5f${B}x5fproto__": P });\nexport const project = (lane: Lane) => ({ v: C });\n`) },
  // 52(*): NOT RESCUED. A duplicate-key object literal is TS1117 and cannot be made
  // type-valid without deleting the duplicate -- i.e. without deleting the defect. These
  // are honest `miss_type_invalid` rows, and the finding they carry is reported in RESULTS:
  // under the pinned surface the COMPILER ITSELF owns this channel.
  // ---- ITEM 14 (R-548 §4): TYPE-CHECKER OWNERSHIP IS ROW-BOUND -------------------------
  // These four rows are credited `caught_by_typechecker` — the planted illegality IS ITSELF a
  // type error. Until now that credit was granted by ONE GLOBAL CODE LIST, so ANY row emitting
  // any listed code was credited, and R-548 §2's attack A bought a credit with an UNRELATED
  // TS2339. The credit is now joined to (ROW, OWNED EXPRESSION, SPAN, EXPECTED DEFECT):
  // every diagnostic the row produces must point AT one of the declared expressions, and every
  // declared expression must be witnessed. `expression` must occur EXACTLY ONCE in the
  // submitted body or the anchor is ambiguous and the row fails closed.
  //   AN ERROR CODE IS A TYPE OF EVENT, NOT PROOF THE EVENT BELONGS TO THIS MUTATION.
  // ⚠️ SCOPE, STATED HONESTLY: `defect` is the human-readable claim that ties the anchor to the
  // plant. The MACHINE-CHECKED key is (row, expression, span, code) — I do not pretend prose is
  // enforced. Every anchor below was MEASURED from the compiler's own span, never guessed.
  { id: '52(a)', atom: 'duplicate cooked keys (raw)', expect: S.GRAMMAR,
    typecheckerOwned: [{ code: 'TS1117', expression: 'a: 2', defect: 'the planted illegality IS the duplicate cooked key `a`' }],
    ...src(`const C = Object.freeze({ a: 1, a: 2 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '52(b)', atom: 'duplicate cooked keys (esc string)', expect: S.GRAMMAR,
    typecheckerOwned: [{ code: 'TS1117', expression: `"${B}x61": 2`, defect: 'duplicate cooked key via escaped STRING form — the compiler cooks `\\x61` to `a`' }],
    ...src(`const C = Object.freeze({ a: 1, "${B}x61": 2 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '52(c)', atom: 'duplicate cooked keys (esc ident)', expect: S.GRAMMAR,
    typecheckerOwned: [{ code: 'TS1117', expression: `${B}u0061: 2`, defect: 'duplicate cooked key via escaped IDENTIFIER form — `\\u0061` cooks to `a`' }],
    ...src(`const C = Object.freeze({ a: 1, ${B}u0061: 2 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '52(d)', atom: 'duplicate cooked keys (mixed)', expect: S.GRAMMAR,
    typecheckerOwned: [{ code: 'TS1117', expression: '"a": 2', defect: 'duplicate cooked key across identifier and string spellings' }],
    ...src(`const C = Object.freeze({ a: 1, "a": 2 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '53',    atom: 'harmless inert static import', expect: S.IMPORT_CARDINALITY,
    ...src(`import { add } from './pure-math.js';\nexport const project = (lane: Lane) => ({ v: add(1, 2) });\n`) },

  // ---- ROW 54, REBUILT AS A TRUE CONTAINER TWIN (R-544 s3 item 7) -----------------------
  // 54 and its GREEN neighbour G-src-container-twin-esm share ONE source text, byte for
  // byte. The only difference is the extension. Every text-level catcher must be SILENT in
  // both arms; the module-system verdict must come from the CONTAINER alone.
  { id: '54',    atom: 'CJS container (.cts) — true twin', expect: S.MODULE_SYSTEM,
    ...src(CONTAINER_TWIN_TS, 'twin.cts') },
  { id: '54(b)', atom: 'CJS container (.cjs) — JS twin', expect: S.MODULE_SYSTEM,
    ...src(CONTAINER_TWIN_JS, 'twin.cjs') },
  // 54(c): the OLD row 54's text-level channel, retained under an HONEST caption. R-544
  // proved it is not a module-system discriminator -- it behaves identically in .mjs and
  // .cjs. It is kept so the claim it really supports stays measured.
  // ⚠️ TWO owned diagnostics, and I found that by MEASURING rather than by declaring one and
  // assuming: TS2532 anchors on `this` (module-scope `this` is `undefined` under ESM — the
  // planted channel) and TS2540 anchors on `HOLDER.slot` (the frozen-container write the same
  // statement performs). BOTH are entailed by what this row plants, so both are declared. Had I
  // declared only the first, the second would have failed the join and the row would have
  // dropped out of `caught_by_typechecker` — which is the guard working, not a nuisance.
  { id: '54(c)', atom: 'module-scope `this` STATEMENT (text-level)', expect: S.MODULE_SYSTEM,
    typecheckerOwned: [
      { code: 'TS2532', expression: 'this.inject', defect: 'module-scope `this` is `undefined` under ESM — the planted text-level channel' },
      { code: 'TS2540', expression: 'HOLDER.slot = f', defect: 'the same statement writes through a frozen container — read-only property' },
    ],
    ...src(`const HOLDER = Object.freeze({ slot: Object.freeze({}) });\nthis.inject = (f: unknown) => { HOLDER.slot = f; };\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },

  // ---- ITEM 8's COMPLEMENTS: the required export ----------------------------------------
  // A module can satisfy a purity rule by OMITTING the object whose purity it certifies.
  // These four are the complement set that makes the rule non-vacuous.
  { id: '55(a)', atom: 'empty module (no project at all)', expect: S.EXPORTS, ...src(`export {};\n`) },
  { id: '55(b)', atom: 'only an unrelated const export', expect: S.EXPORTS, ...src(`export const x = 1;\n`) },
  { id: '55(c)', atom: 'only a helper function export', expect: S.EXPORTS, ...src(`export function helper(): number { return 1; }\n`) },
  { id: '55(d)', atom: 'non-callable `project` export', expect: S.EXPORTS, ...src(`export const project = 1;\n`) },

  // ---- ROWS ADDED FROM THE accuracy-validator's HUNT (GRADE-P0PC-PARTITION-2026-08-02) ----
  // Both defects were CRITICAL, both were reproduced here by execution before repair, and
  // both are now guarded. RED WITHOUT THE FIX, GREEN WITH IT — measured in both directions.
  //
  // F-1: the rule keyed on `ts.isImportDeclaration` ALONE. `export * from './ledger.js'` was
  // ADMITTED with violations=[] and importCount=0 — and the STAR form carries NO Identifier
  // node, so the identifier catchers were blind too. These four cover the module-edge GRAMMAR
  // rather than only the one form that was missed.
  { id: '56(a)', atom: 'static edge: export * from', expect: S.IMPORT_CARDINALITY,
    ...src(`export * from './ledger.js';\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  { id: '56(b)', atom: 'static edge: export { x } from', expect: S.IMPORT_CARDINALITY,
    ...src(`export { read } from './ledger.js';\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  { id: '56(c)', atom: 'static edge: export * as ns from', expect: S.IMPORT_CARDINALITY,
    ...src(`export * as ns from './ledger.js';\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  { id: '56(d)', atom: 'static edge: import x = require(...)', expect: S.IMPORT_CARDINALITY,
    ...src(`import ledger = require('./ledger.js');\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },
  // F-2: `ts.isTypeNode(ExpressionWithTypeArguments)` is TRUE, and it is the one TypeNode kind
  // whose `.expression` slot holds a LIVE value. The ANONYMOUS form is the decisive fixture —
  // the NAMED form reddened only incidentally, on its class name tripping the residual.
  { id: '57', atom: 'runtime capture in an `extends` heritage slot', expect: S.AMBIENT,
    ...src(`export const project = (lane: Lane) => ({ v: new (class extends window.Base {})() });\n`) },

  // ---------- 1b-R : runtime ----------
  { id: '39', atom: 'function-valued field', expect: R.FUNCTION_VALUE,
    ...val(() => ({ id: 'L1', read: () => 'LEDGER' })) },
  { id: '40', atom: 'accessor descriptor', expect: R.ACCESSOR,
    ...val(() => ({ id: 'L1', get bindings() { globalThis.__GETTER_HITS__++; return 'LEDGER'; } })) },
  { id: '42', atom: 'custom / class prototype', expect: R.PROTOTYPE,
    ...val(() => { class Lane { constructor() { this.id = 'L1'; } read() { return 'LEDGER'; } } return new Lane(); }) },
  { id: '43', atom: 'cycle', expect: R.CYCLE,
    ...val(() => { const r = { id: 'L1' }; r.self = r; return r; }) },
  { id: '44', atom: 'symbol key', expect: R.SYMBOL_KEY,
    ...val(() => { const o = { id: 'L1' }; o[Symbol('ledgerRead')] = () => 'LEDGER'; return o; }) },
  { id: '45(a)', atom: 'undefined value', expect: R.VALUE_CLASS, ...val(() => ({ id: 'L1', a: undefined })) },
  { id: '45(b)', atom: 'bigint value', expect: R.VALUE_CLASS, ...val(() => ({ id: 'L1', a: 10n })) },
  { id: '45(c)', atom: 'symbol value', expect: R.VALUE_CLASS, ...val(() => ({ id: 'L1', a: Symbol('x') })) },
  { id: '45(d)', atom: 'NaN', expect: R.VALUE_CLASS, ...val(() => ({ id: 'L1', a: NaN })) },
  { id: '45(e)', atom: '+/-Infinity', expect: R.VALUE_CLASS, ...val(() => ({ id: 'L1', a: Infinity })) },
  { id: '46(a)', atom: 'sparse hole', expect: R.ARRAY_SHAPE, ...val(() => ({ id: 'L1', a: [1, , 3] })) },
  { id: '46(b)', atom: 'extra named array property', expect: R.ARRAY_SHAPE,
    ...val(() => { const a = [1, 2]; a.note = 'x'; return { id: 'L1', a }; }) },
  { id: '47', atom: 'non-enumerable user field', expect: R.NON_ENUMERABLE,
    ...val(() => { const o = { id: 'L1' }; Object.defineProperty(o, 'hidden', { value: 1, enumerable: false }); return o; }) },
];

// GREEN neighbours: each must be ADMITTED. A rule that rejects these is not stricter, it is broken.
export const GREEN = [
  { id: 'G-src-clean', kind: 'source', file: 'green.ts',
    body: `const C = Object.freeze({ a: 1, b: Object.freeze({ c: "x" }) });\nexport const project = (lane: Lane) => ({ v: lane.v, k: C.a });\n` },
  // THE TWIN'S GREEN ARM: byte-identical to row 54's body, different container only.
  { id: 'G-src-container-twin-esm', kind: 'source', file: 'twin.mts', body: CONTAINER_TWIN_TS },
  { id: 'G-src-container-twin-mjs', kind: 'source', file: 'twin.mjs', body: CONTAINER_TWIN_JS },
  // ---- THE `implements` GAP, CLOSED (R-551 §3, ordered in the same wave as F-2-CORRECTED) --
  // The corpus held ZERO `implements` rows, so it was STRUCTURALLY INCAPABLE of seeing the
  // over-correction that R-550 §5(3) pre-registered as a stop condition — and my F-2 fix
  // tripped it while every gate stayed green. A corpus that cannot see a defect cannot
  // certify its absence.
  { id: 'G-src-implements-erased', kind: 'source', file: 'green.ts',
    body: `export const project = (lane: Lane) => { class Impl implements Widget { w = 1; } return { v: new Impl() }; };\n` },
  { id: 'G-src-interface-extends-erased', kind: 'source', file: 'green.ts',
    body: `interface Ext extends Widget { z: number }\nexport const project = (lane: Lane) => ({ v: 1 } as unknown as Ext);\n` },
  { id: 'G-run-plain', kind: 'runtime', factory: () => ({ id: 'L1', bindable: true, note: 'x' }) },
  { id: 'G-run-dag', kind: 'runtime', factory: () => { const s = { v: 1 }; return { id: 'L1', p: s, q: s }; } },
  { id: 'G-run-array', kind: 'runtime', factory: () => ({ id: 'L1', a: [1, 2, 3], nested: { b: null } }) },
];

// The twin pairing is asserted by the runner, not assumed: same bytes, different container.
export const TWIN_PAIRS = [
  { redId: '54', greenId: 'G-src-container-twin-esm' },
  { redId: '54(b)', greenId: 'G-src-container-twin-mjs' },
];

// ---- THE LIKE-FOR-LIKE COMPARISON SET --------------------------------------------------
// R-543 s4 / R-544 s3 pre-registered that the corrected number MUST FALL below AR-589's
// 49/52. This corpus is now 59 rows, so the raw ratio is NOT comparable: 7 rows were ADDED
// (the 34(d) split, the two container-twin arms, and item 8's four complements). Comparing
// 50/59 against 49/52 would be comparing two different populations, which is the exact
// join-key error this campaign has been convicted of repeatedly.
//
// So the ORIGINAL 52 subcases are named here BY ID and the runner scores them separately.
// The mapping that needs stating: AR-589's row `54` was the module-scope `this` STATEMENT,
// which now lives at `54(c)`. The new `54` is the container twin and is NOT in this set.
// ---- ITEM 11 (R-546 §5.11): EMIT CHANGES DECLARED, WITH THEIR REASON ------------------
// A fixture edit that changes emitted JS WITHOUT a separately pre-registered mutation is a
// STOP CONDITION (R-546 §7). These are the ONLY rows whose emitted JavaScript this round is
// permitted to differ from AR-589's, and each reason was published in RESULTS §2 BEFORE
// `emitted-freeze.mjs` was run against them. Everything else must come back EMIT-IDENTICAL;
// anything that does not is reported UNDECLARED and fails the check rather than being
// retro-fitted with an excuse here.
export const PREREGISTERED_EMIT_CHANGES = {
  '51(a)': 'use site reads `C` instead of `C.x`. TS types the literal WITHOUT the inherited member (its type view does not model `__proto__`\'s runtime prototype-setting), so `C.x` was TS2339 — incidental, not the channel. The `__proto__` KEY is untouched.',
  '51(b)': 'as 51(a) — raw StringLiteral key form.',
  '51(c)': 'as 51(a) — escaped identifier key form.',
  '51(d)': 'as 51(a) — escaped string key form.',
  // ⚠️ 26(a) WAS DROPPED FROM THIS LIST AND IS RESTORED. I removed it on the reasoning that it
  // came back EMIT-IDENTICAL — which was true, and true only because an UNUSED import is
  // ELIDED by the emitter, so the comparator could not see the change at all. Once the
  // accuracy-validator's F-3 forced a SECOND path (the module-edge set read from the source
  // AST), that path convicted it immediately. `A DECLARATION I DROPPED BECAUSE THE INSTRUMENT
  // COULD NOT SEE THE CHANGE IS A DECLARATION I OWED.`
  // 26(b) stays off the list: measured, its module edge is genuinely UNCHANGED (`node:fs`
  // needs no extension), so there is nothing to declare.
  '26(a)': 'relative specifier `./ledger` -> `./ledger.js`, required by NodeNext resolution; without it the fixture is TS2792 and yields no verdict. INVISIBLE to the emit comparator because the unused import is elided — declared here on the strength of the module-edge path. The import, and therefore its cardinality, is unchanged.',
  '26(c)': 'relative specifier carries the explicit `.js` extension required by NodeNext resolution; without it the fixture is TS2792 and yields no verdict at all. This one survives emit because a bare side-effect import is not elided. The import — and therefore its cardinality, the planted mutation — is unchanged.',
  '41(a)': 'as 26(c) — dynamic `import(\'./ledger\')` -> `import(\'./ledger.js\')`. The dynamic-load channel is unchanged.',
  '53': 'as 26(c) — `./pure-math` -> `./pure-math.js`. The import-cardinality mutation is unchanged.',
  // ⚠️★★★★★ DECLARED LATE, AND I LABEL IT HONESTLY RATHER THAN CALLING IT A PRE-REGISTRATION.
  // ITEM 16 RESTORED THIS ROW TO THE COMPARISON AND IT CONVICTED ON THE FIRST RUN. The freeze
  // gate had NEVER seen 54(c): it filed the baseline row under its baseline id `54`, looked up
  // `54(c)`, got undefined, and hit the silent `continue`. The denominator read 38 instead of 39
  // and the row's edit went unexamined from the moment it was made.
  //   THIS IS 26(a) AGAIN, ONE LEVEL OUT: there the comparator could not see the CHANGE; here it
  //   could not see the ROW. `A DECLARATION I NEVER MADE BECAUSE THE INSTRUMENT COULD NOT SEE
  //   THE ROW IS A DECLARATION I OWED.`
  // ⚠️ F-6 SCOPE, STATED PLAINLY: this entry is NOT a prediction and I will not dress it as one.
  // It is written AFTER the instrument first became able to see the row. It is admissible only
  // because the reason below is MEASURED, and the measurement is reproducible on demand.
  // `[MEASURED HERE]` the baseline body under the CURRENT pinned surface:
  //   verbatim                  -> TS2532 `this` + TS7006 x2 (implicit any — SURFACE codes) + TS2339 `read`
  //   + type annotations ONLY   -> TS2532 `this` + TS2339 `Property 'read' does not exist on type 'Readonly<{}>'`
  //   current 54(c)             -> TS2532 `this` + TS2540 `Cannot assign to 'slot'`
  // So the annotations alone leave an INCIDENTAL TS2339 that is NOT the channel under test, and
  // corpus.mjs's own standing rule (header, lines 21-25) is: where a fixture's INCIDENTAL type
  // error is not the channel, adjust the USE SITE and LEAVE THE DEFECT INTACT.
  // ✅ THE PLANTED DEFECT IS INTACT: `this.inject = ...` — the module-scope `this` STATEMENT — is
  // byte-identical across baseline and current. Only the write target inside the arrow body
  // moved (`HOLDER.slot.read = f` -> `HOLDER.slot = f`), which is not the channel.
  '54(c)': 'INCIDENTAL type error removed, planted channel untouched: the write target moved `HOLDER.slot.read = f` -> `HOLDER.slot = f` because the baseline form is TS2339 (`read` does not exist on `Readonly<{}>`) under the pinned surface, which is not the module-scope-`this` channel this row tests. The `this.inject` statement — the planted defect — is byte-identical. Declared LATE (not predictively): item 16 restored this row to the comparison, which had silently dropped it since 54(c) was created.',
};

// ---- ITEM 15 (R-548 §4) — THE SELF-AUTHORED MEMBERSHIP SET IS DELETED FROM THIS FILE ----
// This is where the defect lived:
//     const ADDED_SINCE_AR589 = new Set([...]);
//     export const ORIGINAL_52_IDS = CORPUS.map((c) => c.id).filter((id) => !ADDED_SINCE_AR589.has(id));
// The "frozen" 52 were computed from `CORPUS` — the very population they exist to constrain —
// so a unique rename (35(a) -> 35(z)) produced `missing_ids: []` and exit 0. The set could not
// disagree with a rename because it authored the rename's result.
//
// The expected membership now lives in `membership.mjs` and is read from the PINNED AR-589
// artifact at 8297ebbe. It is deliberately NOT re-exported from here: R-555 §5 makes
// re-deriving it from `CORPUS` under any new name a STOP CONDITION, and the cheapest way to
// keep that true is for this file to have no such export to reach for.
// Consumers import { EXPECTED_ORIGINAL_IDS, checkMembership } from './membership.mjs'.
