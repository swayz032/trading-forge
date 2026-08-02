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
    ...src(`import { read } from './ledger.js';\nexport const project = (lane: Lane) => ({ v: lane.v, r: read('k') });\n`) },
  { id: '26(b)', atom: 'filesystem / network module', expect: NOT_IMPLEMENTED,
    ...src(`import fs from 'node:fs';\nexport const project = (lane: Lane) => ({ v: lane.v, f: fs });\n`) },
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
  { id: '34(d-u)', atom: 'free reference to an UNDECLARED name', expect: S.FREE_REF,
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
    ...src(`let Sg = { n: 1 };\nexport const project = (lane: Lane) => ({ v: Sg.n });\n`) },
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
    ...src(`const k = 'a';\nconst C = Object.freeze({ [k]: 1 });\nexport const project = (lane: Lane) => ({ v: C });\n`) },
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
  { id: '52(a)', atom: 'duplicate cooked keys (raw)', expect: S.GRAMMAR,
    ...src(`const C = Object.freeze({ a: 1, a: 2 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '52(b)', atom: 'duplicate cooked keys (esc string)', expect: S.GRAMMAR,
    ...src(`const C = Object.freeze({ a: 1, "${B}x61": 2 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '52(c)', atom: 'duplicate cooked keys (esc ident)', expect: S.GRAMMAR,
    ...src(`const C = Object.freeze({ a: 1, ${B}u0061: 2 });\nexport const project = (lane: Lane) => ({ v: C.a });\n`) },
  { id: '52(d)', atom: 'duplicate cooked keys (mixed)', expect: S.GRAMMAR,
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
  { id: '54(c)', atom: 'module-scope `this` STATEMENT (text-level)', expect: S.MODULE_SYSTEM,
    ...src(`const HOLDER = Object.freeze({ slot: Object.freeze({}) });\nthis.inject = (f: unknown) => { HOLDER.slot = f; };\nexport const project = (lane: Lane) => ({ v: lane.v });\n`) },

  // ---- ITEM 8's COMPLEMENTS: the required export ----------------------------------------
  // A module can satisfy a purity rule by OMITTING the object whose purity it certifies.
  // These four are the complement set that makes the rule non-vacuous.
  { id: '55(a)', atom: 'empty module (no project at all)', expect: S.EXPORTS, ...src(`export {};\n`) },
  { id: '55(b)', atom: 'only an unrelated const export', expect: S.EXPORTS, ...src(`export const x = 1;\n`) },
  { id: '55(c)', atom: 'only a helper function export', expect: S.EXPORTS, ...src(`export function helper(): number { return 1; }\n`) },
  { id: '55(d)', atom: 'non-callable `project` export', expect: S.EXPORTS, ...src(`export const project = 1;\n`) },

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
const ADDED_SINCE_AR589 = new Set(['34(d-u)', '54', '54(b)', '55(a)', '55(b)', '55(c)', '55(d)']);
export const ORIGINAL_52_IDS = CORPUS.map((c) => c.id).filter((id) => !ADDED_SINCE_AR589.has(id));
