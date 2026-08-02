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
import { CATCHERS as S } from './source-admission.mjs';
import { CATCHERS as R } from './runtime-admission.mjs';

const B = String.fromCharCode(92); // backslash, so escape fixtures survive authoring

// A catcher the design names but the prototype does not implement.
export const NOT_IMPLEMENTED = '1b-S:dependency-boundary';

const src = (body) => ({ kind: 'source', body });
const val = (factory) => ({ kind: 'runtime', factory });

export const CORPUS = [
  // ---------- 1b-S : source ----------
  { id: '26(a)', atom: 'unallowlisted import', expect: NOT_IMPLEMENTED,
    ...src(`import { read } from './ledger';\nexport const project = (lane) => ({ v: lane.v });\n`) },
  { id: '26(b)', atom: 'filesystem / network module', expect: NOT_IMPLEMENTED,
    ...src(`import fs from 'node:fs';\nexport const project = (lane) => ({ v: lane.v });\n`) },
  { id: '26(c)', atom: 'transitive edge to either', expect: NOT_IMPLEMENTED,
    ...src(`import './helper';\nexport const project = (lane) => ({ v: lane.v });\n`) },
  { id: '34(a)', atom: 'setter / configuration export', expect: S.EXPORTS,
    ...src(`const HOLDER = Object.freeze({ slot: Object.freeze({}) });\nexport const configure = (f) => { HOLDER.slot = f; };\nexport const project = (lane) => ({ v: lane.v });\n`) },
  { id: '34(b)', atom: 'function-valued export != project', expect: S.EXPORTS,
    ...src(`export const getLedger = () => 1;\nexport const project = (lane) => ({ v: lane.v });\n`) },
  { id: '34(c)', atom: 'export that mutates module state', expect: S.EXPORTS,
    ...src(`const H = Object.freeze({ a: 1 });\nexport const reset = () => { H.a = 2; };\nexport const project = (lane) => ({ v: lane.v });\n`) },
  { id: '34(d)', atom: 'free / captured reference', expect: S.FREE_REF,
    ...src(`export const project = (lane) => ({ v: injectedReader(lane) });\n`) },
  { id: '35(a)', atom: 'globalThis', expect: S.AMBIENT,
    ...src(`export const project = (lane) => ({ v: globalThis.__ledger });\n`) },
  { id: '35(b)', atom: 'window', expect: S.AMBIENT,
    ...src(`export const project = (lane) => ({ v: window.__ledger });\n`) },
  { id: '35(c)', atom: 'global (alias of globalThis)', expect: S.AMBIENT,
    ...src(`export const project = (lane) => ({ v: global.__ledger });\n`) },
  { id: '35(d)', atom: 'ANY unallowlisted host-global', expect: S.AMBIENT,
    ...src(`export const project = (lane) => ({ v: Reflect.ownKeys(lane) });\n`) },
  { id: '36',    atom: 'process / process.env', expect: S.AMBIENT,
    ...src(`export const project = (lane) => ({ v: process.env.LEDGER_PATH });\n`) },
  { id: '37(a)', atom: 'mutable module-scope binding', expect: S.MODULE_STATE,
    ...src(`let cache = null;\nexport const project = (lane) => ({ v: cache });\n`) },
  { id: '37(b)', atom: 'cache populated on first call', expect: S.MODULE_STATE,
    ...src(`var c = 0;\nexport const project = (lane) => ({ v: c });\n`) },
  { id: '37(c)', atom: 'singleton', expect: S.MODULE_STATE,
    ...src(`let S = { n: 1 };\nexport const project = (lane) => ({ v: S.n });\n`) },
  { id: '37(d)', atom: 'lazily-initialised holder', expect: S.MODULE_STATE,
    ...src(`let H;\nexport const project = (lane) => ({ v: H });\n`) },
  { id: '38',    atom: 'SHALLOW-frozen nested holder', expect: S.GRAMMAR,
    ...src(`const HOLDER = Object.freeze({ slot: {} });\nexport const project = (lane) => ({ v: HOLDER.slot });\n`) },
  { id: '41(a)', atom: 'import()', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = async (lane) => ({ v: await import('./ledger') });\n`) },
  { id: '41(b)', atom: 'require, computed specifier', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane) => ({ v: require('./' + lane.n) });\n`) },
  { id: '41(c)', atom: 'eval', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane) => ({ v: eval('1+1') });\n`) },
  { id: '41(d)', atom: 'new Function', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane) => ({ v: new Function('return 1')() });\n`) },
  { id: '41(e)', atom: 'createRequire', expect: S.DYNAMIC_LOAD,
    ...src(`export const project = (lane) => ({ v: createRequire('x') });\n`) },
  { id: '48',    atom: 'helper-returned module constant', expect: S.GRAMMAR,
    ...src(`const C = deepFreeze({ a: 1 });\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '49(a)', atom: 'spread escape', expect: S.GRAMMAR,
    ...src(`const base = Object.freeze({ a: 1 });\nconst C = Object.freeze({ ...base });\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '49(b)', atom: 'bare alias', expect: S.GRAMMAR,
    ...src(`const base = Object.freeze({ a: 1 });\nconst C = base;\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '49(c)', atom: 'computed key', expect: S.GRAMMAR,
    ...src(`const k = 'a';\nconst C = Object.freeze({ [k]: 1 });\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '50(a)', atom: 'shadowed / local freeze callee', expect: S.GRAMMAR,
    ...src(`const Object2 = { freeze: (x) => x };\nconst C = Object2.freeze({ slot: {} });\nexport const project = (lane) => ({ v: C.slot });\n`) },
  { id: '50(b)', atom: 'locally-declared freeze', expect: S.GRAMMAR,
    ...src(`const freeze = (x) => x;\nconst C = freeze({ slot: {} });\nexport const project = (lane) => ({ v: C.slot });\n`) },
  { id: '50(c)', atom: 'aliased freeze binding', expect: S.GRAMMAR,
    ...src(`const f = Object.freeze;\nconst C = f({ slot: {} });\nexport const project = (lane) => ({ v: C.slot });\n`) },
  { id: '51(a)', atom: '__proto__ key (raw Ident)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ __proto__: P });\nexport const project = (lane) => ({ v: C.x });\n`) },
  { id: '51(b)', atom: '__proto__ key (raw StringLit)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ "__proto__": P });\nexport const project = (lane) => ({ v: C.x });\n`) },
  { id: '51(c)', atom: '__proto__ key (escaped identifier)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ ${B}u005f${B}u005fproto__: P });\nexport const project = (lane) => ({ v: C.x });\n`) },
  { id: '51(d)', atom: '__proto__ key (escaped string)', expect: S.GRAMMAR,
    ...src(`const P = Object.freeze({ x: 1 });\nconst C = Object.freeze({ "${B}x5f${B}x5fproto__": P });\nexport const project = (lane) => ({ v: C.x });\n`) },
  { id: '52(a)', atom: 'duplicate cooked keys (raw)', expect: S.GRAMMAR,
    ...src(`const C = Object.freeze({ a: 1, a: 2 });\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '52(b)', atom: 'duplicate cooked keys (esc string)', expect: S.GRAMMAR,
    ...src(`const C = Object.freeze({ a: 1, "${B}x61": 2 });\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '52(c)', atom: 'duplicate cooked keys (esc ident)', expect: S.GRAMMAR,
    ...src(`const C = Object.freeze({ a: 1, ${B}u0061: 2 });\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '52(d)', atom: 'duplicate cooked keys (mixed)', expect: S.GRAMMAR,
    ...src(`const C = Object.freeze({ a: 1, "a": 2 });\nexport const project = (lane) => ({ v: C.a });\n`) },
  { id: '53',    atom: 'harmless inert static import', expect: S.IMPORT_CARDINALITY,
    ...src(`import { add } from './pure-math';\nexport const project = (lane) => ({ v: add(1, 2) });\n`) },
  { id: '54',    atom: 'CJS module-wrapper `this` channel', expect: S.MODULE_SYSTEM,
    ...src(`const HOLDER = Object.freeze({ slot: Object.freeze({}) });\nthis.inject = (f) => { HOLDER.slot.read = f; };\nexport const project = (lane) => ({ v: lane.v });\n`) },

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
  { id: 'G-src-clean', kind: 'source', body: `const C = Object.freeze({ a: 1, b: Object.freeze({ c: "x" }) });\nexport const project = (lane) => ({ v: lane.v, k: C.a });\n` },
  { id: 'G-src-esm-twin', kind: 'source', body: `const HOLDER = Object.freeze({ slot: Object.freeze({}) });\nexport const project = (lane) => ({ v: lane.v });\n` },
  { id: 'G-run-plain', kind: 'runtime', factory: () => ({ id: 'L1', bindable: true, note: 'x' }) },
  { id: 'G-run-dag', kind: 'runtime', factory: () => { const s = { v: 1 }; return { id: 'L1', p: s, q: s }; } },
  { id: 'G-run-array', kind: 'runtime', factory: () => ({ id: 'L1', a: [1, 2, 3], nested: { b: null } }) },
];
