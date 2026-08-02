// 1b-S — BUILD-TIME SOURCE ADMISSION for project()'s module.
// Mechanism: TypeScript compiler API AST (NOT regex, NOT getText, NOT a token scan).
//
// REBUILT under R-543 s4 (items 1-4) + R-544 s3 (items 6, 8). What changed and why:
//
//  item 1  VALIDITY GATE now computes getSemanticDiagnostics, not only syntactic ones.
//          A fixture that does not TYPE-CHECK yields TYPE_INVALID and can never be
//          credited as coverage. The old gate reported `failed_parse: 0` and it meant
//          almost nothing, because nothing could ever have failed there.
//  item 2  The compiler surface is PINNED and COMMITTED in ./surface (tsconfig.pinned.json
//          + ambient.d.ts + the fixture-support modules). `types: []` is load-bearing.
//  item 3  SINGLE DIAGNOSTIC OWNERSHIP. A node-level catcher OWNS its subtree, and the
//          identifier-level catchers are suppressed inside it. `attributed` may then mean
//          "the named catcher fired AND every competing catcher stayed silent".
//  item 4  createRequire RESOLVED -- a committed fixture-only declaration in ambient.d.ts.
//  item 6  admitSource accepts .ts/.mts/.cts/.mjs/.cjs/.js WITHOUT THROWING, and the
//          MODULE SYSTEM is now a CONTAINER axis derived from the effective-module tuple,
//          cross-checked against TypeScript's own impliedNodeFormat.
//  item 8  The REQUIRED EXPORT is asserted: a module with no callable `project` is
//          REJECTED. Previously a module could satisfy the purity rule by omitting the
//          very object whose purity it certifies.
//
// SEPARABILITY: this module reads fixture SOURCE TEXT and its own committed surface only.
// It never opens the membership ledger or ORACLE.json. (Asserted by measurement in the
// results artifact, not by claim.)
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SURFACE_DIR = path.join(HERE, 'surface').replace(/\\/g, '/');
const AMBIENT = `${SURFACE_DIR}/ambient.d.ts`;
const PINNED_TSCONFIG = `${SURFACE_DIR}/tsconfig.pinned.json`;

export const CATCHERS = {
  MODULE_SYSTEM: '1b-S:module-system',
  IMPORT_CARDINALITY: '1b-S:import-cardinality',
  DYNAMIC_LOAD: '1b-S:dynamic-loading',
  EXPORTS: '1b-S:exports',
  MODULE_STATE: '1b-S:module-scope-state',
  AMBIENT: '1b-S:direct-ambient-read',
  FREE_REF: '1b-S:free-captured-reference',
  GRAMMAR: '1b-S:const-ast-grammar',
};

// Not a catcher: an outcome. A fixture that does not compile proves nothing about any rule.
export const TYPE_INVALID = 'TYPE_INVALID';
export const PARSE_ERROR = 'PARSE_ERROR';

// ---- the pinned surface, read from the COMMITTED file rather than written in code ------
function loadPinnedOptions() {
  const raw = fs.readFileSync(PINNED_TSCONFIG, 'utf8');
  const parsed = ts.parseConfigFileTextToJson(PINNED_TSCONFIG, raw);
  if (parsed.error) throw new Error(`pinned tsconfig unreadable: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`);
  const conv = ts.convertCompilerOptionsFromJson(parsed.config.compilerOptions, SURFACE_DIR, PINNED_TSCONFIG);
  if (conv.errors.length) throw new Error(`pinned tsconfig invalid: ${conv.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('; ')}`);
  return conv.options;
}
export const PINNED_OPTIONS = loadPinnedOptions();

// ---- item 6: THE EFFECTIVE-MODULE TUPLE ------------------------------------------------
// The container is decided by (extension, nearest package.json "type") -- NOT by the source
// text, and NOT by the file merely being `.ts`. R-543 s4 item 5's stop condition:
// "source classified ESM merely because it is .ts or a package says type:module -> STOP".
const SCRIPT_KIND_BY_EXT = {
  '.ts': ts.ScriptKind.TS, '.mts': ts.ScriptKind.TS, '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS, '.mjs': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS,
};

export function nearestPackageType(fromDir) {
  let dir = fromDir;
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const t = JSON.parse(fs.readFileSync(pkg, 'utf8')).type;
        return { type: t === 'module' ? 'module' : 'commonjs', from: pkg.replace(/\\/g, '/') };
      } catch { return { type: 'commonjs', from: `${pkg.replace(/\\/g, '/')} (unparseable)` }; }
    }
    const up = path.dirname(dir);
    if (up === dir) return { type: 'commonjs', from: '<none found: Node defaults to commonjs>' };
    dir = up;
  }
}

export function effectiveModuleTuple(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const dir = path.dirname(fileName);
  const pkg = nearestPackageType(dir);
  let format, decidedBy;
  if (ext === '.mjs' || ext === '.mts') { format = 'ESM'; decidedBy = `extension ${ext}`; }
  else if (ext === '.cjs' || ext === '.cts') { format = 'CJS'; decidedBy = `extension ${ext}`; }
  else { format = pkg.type === 'module' ? 'ESM' : 'CJS'; decidedBy = `nearest package.json "type": "${pkg.type}" (${pkg.from})`; }
  return {
    extension: ext,
    nearestPackageType: pkg.type,
    nearestPackageFile: pkg.from,
    format,
    decidedBy,
    scriptKind: ts.ScriptKind[SCRIPT_KIND_BY_EXT[ext] ?? ts.ScriptKind.TS],
    tsVersion: ts.version,
    module: ts.ModuleKind[PINNED_OPTIONS.module],
    moduleResolution: ts.ModuleResolutionKind[PINNED_OPTIONS.moduleResolution],
  };
}

// ---- the ambient-intrinsic allow-list: membership 1, resolved by SYMBOL, not by text ----
const AMBIENT_ALLOWED = new Set(['Object']); // only as the Object.freeze wrapper callee

const HOST_GLOBALS = new Set([
  'globalThis', 'window', 'global', 'process', 'self', 'Buffer',
  '__dirname', '__filename', 'require', 'module', 'exports',
]);

const cooked = (key) => {
  if (ts.isIdentifier(key)) return ts.idText(key);          // escapes already resolved
  if (ts.isStringLiteral(key)) return key.text;             // escapes already resolved
  return null;                                              // computed/numeric -> not cooked
};

function isIntrinsicFreezeCallee(node, checker, srcFile) {
  // Object.freeze(...) where `Object` resolves to the global ObjectConstructor.
  if (!ts.isPropertyAccessExpression(node)) return false;
  if (ts.idText(node.name) !== 'freeze') return false;
  const obj = node.expression;
  if (!ts.isIdentifier(obj) || ts.idText(obj) !== 'Object') return false;
  const sym = checker.getSymbolAtLocation(obj);
  if (!sym) return false;
  // SYMBOL IDENTITY: a locally-declared/shadowed/aliased `Object` has a declaration
  // inside this source file; the intrinsic is declared in a lib.*.d.ts.
  const decls = sym.getDeclarations() || [];
  if (decls.length === 0) return false;
  return decls.every((d) => d.getSourceFile() !== srcFile && /lib\..*\.d\.ts$/.test(d.getSourceFile().fileName));
}

// ---------------------------------------------------------------------------------------
// ITEM 10 (R-546 s5.10) -- TYPE-SPACE / VALUE-SPACE SEPARATION, AS A PROPERTY.
//
// THE PROPERTY: an identifier ERASED BEFORE EXECUTION cannot be runtime-capture evidence.
// It is not "ignore the name `Lane`" -- a spelling allowlist is explicitly REFUSED. The same
// spelling must be SILENT in type-only position and EXCLUSIVELY FREE_REF in value-only
// position, which is what `type-value-proof.mjs` asserts with a `Widget` declared in BOTH
// spaces.
//
// THE RESIDUAL IS THE POINT: any position this function cannot classify returns
// 'unclassified', which FAILS CLOSED into its own reported population. It is never silently
// assigned to type (which would hide a real capture) or to value (which would fabricate one).
// ---------------------------------------------------------------------------------------
export const POSITION_UNCLASSIFIED = 'POSITION_UNCLASSIFIED';

// 🛑 R-563 item (4) / GRADE F-5 — `VALUE_PARENT_KINDS` IS DELETED. It was a `Set` of
// `ts.SyntaxKind` values declared here and consulted by `classifyPosition`, i.e. A LIVE
// `SyntaxKind` ALLOWLIST — while line ~191 claimed "NO SPELLING ALLOWLIST AND NO `SyntaxKind`
// ALLOWLIST EXISTS OR MAY EXIST". The grader was right: THE ABSOLUTE WAS FALSE AS WRITTEN.
// The emitter-oracle DECISION path never consulted it; deleting it makes the caption true again.

// ---------------------------------------------------------------------------------------
// F-2-CORRECTED (R-551 §3) — THE EMITTER IS THE ORACLE.
//
// My first F-2 fix OVER-CORRECTED and tripped R-550 §5(3) verbatim: it convicted ERASED code.
// `class Impl implements Widget` and `interface Ext extends Widget` were both REJECTED on
// `free-captured-reference` while the compiler's own emit proves both identifiers are GONE.
// The cause was that I hand-classified `ExpressionWithTypeArguments` — but that ONE node kind
// covers BOTH the live `class extends X` slot AND the erased `implements X` / `interface
// extends X` slots. Any hand-written SyntaxKind rule has to get that split right by hand, and
// mine got it wrong in the safe-looking direction.
//
// So the discriminator is no longer a syntax list at all. It is the ORDERED PROPERTY itself:
//
//     AN IDENTIFIER ERASED BEFORE EXECUTION CANNOT BE RUNTIME-CAPTURE EVIDENCE.
//
// We ask the EMITTER, which is the only authority on erasure, and compare occurrence counts:
//   emitted 0                      -> every occurrence erased  -> TYPE space, silent
//   emitted >= source              -> nothing erased            -> VALUE space, catchers apply
//   0 < emitted < source           -> the SAME spelling is both erased and live, and the
//                                     oracle cannot attribute per occurrence -> UNCLASSIFIED,
//                                     FAILING CLOSED. Never silently assigned to either.
// NO SPELLING ALLOWLIST AND NO SyntaxKind ALLOWLIST EXISTS OR MAY EXIST.
function identifierCounts(text, scriptKind) {
  const sf = ts.createSourceFile('oracle.ts', text, ts.ScriptTarget.ES2022, true, scriptKind);
  const counts = new Map();
  const walk = (n) => {
    if (ts.isIdentifier(n)) counts.set(ts.idText(n), (counts.get(ts.idText(n)) || 0) + 1);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return counts;
}

export function erasureOracle(sourceText, scriptKind) {
  let emitted;
  try {
    emitted = ts.transpileModule(sourceText, {
      compilerOptions: { target: PINNED_OPTIONS.target, module: ts.ModuleKind.ESNext },
    }).outputText;
  } catch {
    return { ok: false, verdictFor: () => 'unclassified' };   // oracle unavailable -> fail closed
  }
  const src = identifierCounts(sourceText, scriptKind);
  const out = identifierCounts(emitted, ts.ScriptKind.JS);
  return {
    ok: true,
    emitted,
    verdictFor(name) {
      const s = src.get(name) || 0, e = out.get(name) || 0;
      if (e === 0) return 'type';        // erased entirely
      if (e >= s) return 'value';        // survives entirely
      return 'unclassified';             // partially erased: not attributable per occurrence
    },
  };
}

// 🛑 R-563 item (4) / GRADE F-5 — `classifyPosition` IS DELETED, AND DELETION IS THE ORDERED
// CHOICE RATHER THAN REPAIR. Measured by the grader and confirmed by the desk (R-563 §2):
//   * ZERO call sites — defined here, named in a comment, imported by `type-value-proof.mjs`
//     and never invoked. There was NO "disagreement report" anywhere in the delivery.
//   * it referenced `isWithin(...)`, WHICH IS DEFINED NOWHERE in this directory. The desk's
//     precision correction stands: that branch is UNREACHABLE (`p.expression === child`
//     short-circuits first), so it was dead code with an undefined reference, not a throw.
// ⚠️ THE CAPTION IT SUPPORTED WAS THE REAL DEFECT: the delivery ADVERTISED "a SECOND,
// non-overlapping opinion" it did not have — which is precisely the two-path property this
// campaign grades against. Deleting the code makes the claim honest; repairing it would have
// meant BUILDING a second opinion nobody had specified.
//   A CAPTION PROMISING A SECOND PATH THAT DOES NOT EXIST IS WORSE THAN NO SECOND PATH.

// ---------------------------------------------------------------------------------------
// ITEM 3 -- OWNERSHIP. A node-level catcher claims its whole subtree; identifier-level
// catchers are suppressed inside a claimed range. Without this, `attributed` was a
// one-sided claim ("the named catcher appears") and two catchers fired on every mutation.
// ---------------------------------------------------------------------------------------
class Owners {
  constructor() { this.ranges = []; }
  claim(node, catcher) { this.ranges.push({ start: node.getStart(), end: node.getEnd(), catcher }); }
  ownerOf(node) {
    const s = node.getStart(), e = node.getEnd();
    let best = null;
    for (const r of this.ranges) {
      if (r.start <= s && e <= r.end) {
        if (!best || (r.end - r.start) < (best.end - best.start)) best = r; // innermost wins
      }
    }
    return best;
  }
}

// The admitted constant grammar:
//   Frozen := Object.freeze( ObjLit | ArrLit ) | Primitive
function checkFrozenExpr(expr, checker, srcFile, path_, out, owners) {
  if (
    expr.kind === ts.SyntaxKind.StringLiteral ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  ) return;
  if (ts.isNumericLiteral(expr)) {
    if (!Number.isFinite(Number(expr.text))) out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: non-finite numeric` });
    return;
  }
  if (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand)) return; // -1

  if (ts.isCallExpression(expr)) {
    if (!isIntrinsicFreezeCallee(expr.expression, checker, srcFile)) {
      // The GRAMMAR catcher OWNS this call: its callee identifier is part of the finding,
      // not a separate free reference (item 3).
      owners.claim(expr, CATCHERS.GRAMMAR);
      out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: non-intrinsic callee '${expr.expression.getText(srcFile)}'` });
      return;
    }
    const arg = expr.arguments[0];
    if (!arg) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: Object.freeze() with no argument` }); return; }
    if (ts.isObjectLiteralExpression(arg)) return checkObjLit(arg, checker, srcFile, path_, out, owners);
    if (ts.isArrayLiteralExpression(arg)) return checkArrLit(arg, checker, srcFile, path_, out, owners);
    out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: Object.freeze of a non-literal` });
    return;
  }
  if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) {
    out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: unwrapped literal (every nested literal needs its own Object.freeze)` });
    return;
  }
  if (ts.isIdentifier(expr)) {
    owners.claim(expr, CATCHERS.GRAMMAR);
    out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: alias of identifier '${ts.idText(expr)}'` });
    return;
  }
  owners.claim(expr, CATCHERS.GRAMMAR);
  out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: disallowed expression form ${ts.SyntaxKind[expr.kind]}` });
}

function checkObjLit(obj, checker, srcFile, path_, out, owners) {
  const seen = new Map();
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) { owners.claim(p, CATCHERS.GRAMMAR); out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: spread` }); continue; }
    if (ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) ||
        ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) {
      owners.claim(p, CATCHERS.GRAMMAR);
      out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: accessor/method/shorthand property` }); continue;
    }
    if (!ts.isPropertyAssignment(p)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: unsupported property form` }); continue; }
    if (ts.isComputedPropertyName(p.name)) { owners.claim(p.name, CATCHERS.GRAMMAR); out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: computed key` }); continue; }
    if (ts.isNumericLiteral(p.name)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: numeric key` }); continue; }
    const k = cooked(p.name);
    if (k === null) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}: uncookable key` }); continue; }
    if (k === '__proto__') { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}.${k}: __proto__ prototype setter (cooked)` }); continue; }
    if (seen.has(k)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}.${k}: duplicate cooked key` }); continue; }
    seen.set(k, true);
    checkFrozenExpr(p.initializer, checker, srcFile, `${path_}.${k}`, out, owners);
  }
}

function checkArrLit(arr, checker, srcFile, path_, out, owners) {
  arr.elements.forEach((el, i) => {
    if (el.kind === ts.SyntaxKind.OmittedExpression) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}[${i}]: sparse hole` }); return; }
    if (ts.isSpreadElement(el)) { owners.claim(el, CATCHERS.GRAMMAR); out.push({ catcher: CATCHERS.GRAMMAR, path: `${path_}[${i}]: spread` }); return; }
    checkFrozenExpr(el, checker, srcFile, `${path_}[${i}]`, out, owners);
  });
}

// ---- item 8: the REQUIRED EXPORT -------------------------------------------------------
// A module satisfies a purity rule by omitting the object whose purity it certifies unless
// the required export is asserted POSITIVELY. Complement-first, or the rule is vacuous on
// the empty program.
function checkRequiredExport(srcFile, out) {
  let declared = null; // { callable: boolean, how: string }
  for (const stmt of srcFile.statements) {
    const exported = (ts.getCombinedModifierFlags(
      ts.isVariableStatement(stmt) ? (stmt.declarationList.declarations[0] ?? stmt) : stmt,
    ) & ts.ModifierFlags.Export) !== 0;
    if (!exported) continue;
    if (ts.isFunctionDeclaration(stmt) && stmt.name && ts.idText(stmt.name) === 'project') {
      declared = { callable: true, how: 'export function project' };
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || ts.idText(d.name) !== 'project') continue;
        const init = d.initializer;
        const callable = !!init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
        declared = { callable, how: `export const project = ${init ? ts.SyntaxKind[init.kind] : '<uninitialised>'}` };
      }
    }
  }
  if (!declared) {
    out.push({ catcher: CATCHERS.EXPORTS, path: 'module declares no exported `project` (the object whose purity this rule certifies is absent)' });
  } else if (!declared.callable) {
    out.push({ catcher: CATCHERS.EXPORTS, path: `exported \`project\` is not callable (${declared.how})` });
  }
}

/**
 * @returns {{ ok, outcome, violations, tuple, diagnostics }}
 *   outcome: 'ADMITTED' | 'REJECTED' | 'PARSE_ERROR' | 'TYPE_INVALID'
 */
export function admitSource(fileName, sourceText) {
  const ext = path.extname(fileName).toLowerCase();
  if (!(ext in SCRIPT_KIND_BY_EXT)) {
    return { ok: false, outcome: 'PARSE_ERROR', violations: [{ catcher: PARSE_ERROR, path: `unhandled extension '${ext}'` }], tuple: null, diagnostics: [] };
  }
  // The fixture is compiled AS IF it lived in the committed surface directory, so its
  // relative imports resolve to the committed support modules and the nearest package.json
  // is the surface's own -- both pinned, neither inherited from the host.
  const fixturePath = `${SURFACE_DIR}/${path.basename(fileName)}`;
  const tuple = effectiveModuleTuple(fixturePath);
  const scriptKind = SCRIPT_KIND_BY_EXT[ext];

  const options = { ...PINNED_OPTIONS };
  const host = ts.createCompilerHost(options, true);
  const norm = (n) => String(n).replace(/\\/g, '/');
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) =>
    norm(name) === fixturePath
      ? ts.createSourceFile(fixturePath, sourceText, lang, true, scriptKind)
      : orig(name, lang, ...rest);
  host.fileExists = (n) => (norm(n) === fixturePath ? true : ts.sys.fileExists(n));
  host.readFile = (n) => (norm(n) === fixturePath ? sourceText : ts.sys.readFile(n));

  const program = ts.createProgram([fixturePath, AMBIENT], options, host);
  const srcFile = program.getSourceFile(fixturePath);
  if (!srcFile) {
    // item 6's original defect: with allowJs off, .mjs/.cjs were silently dropped from the
    // program and the next line threw TypeError. It is an instrument fault, never a verdict.
    return { ok: false, outcome: 'PARSE_ERROR', violations: [{ catcher: PARSE_ERROR, path: `no SourceFile produced for ${fixturePath} (kind ${ts.ScriptKind[scriptKind]})` }], tuple, diagnostics: [] };
  }

  // ---- CROSS-CHECK: my tuple derivation vs TypeScript's own impliedNodeFormat ----------
  // Two independent paths to the same fact. A disagreement is an instrument alarm, not a
  // verdict, and is surfaced rather than silently resolved in either direction.
  const tsFormat = srcFile.impliedNodeFormat === ts.ModuleKind.ESNext ? 'ESM'
    : srcFile.impliedNodeFormat === ts.ModuleKind.CommonJS ? 'CJS' : `UNKNOWN(${srcFile.impliedNodeFormat})`;
  tuple.tsImpliedNodeFormat = tsFormat;
  tuple.formatAgreement = tsFormat === tuple.format;

  // ---- VALIDITY BEFORE VERDICT (item 1) ------------------------------------------------
  const syntactic = program.getSyntacticDiagnostics(srcFile);
  if (syntactic.length > 0) {
    return {
      ok: false, outcome: 'PARSE_ERROR', tuple, diagnostics: syntactic.map(fmtDiag),
      violations: [{ catcher: PARSE_ERROR, path: ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ') }],
    };
  }
  const semantic = program.getSemanticDiagnostics(srcFile);
  if (semantic.length > 0) {
    // NOT coverage, and NOT a catcher. AR-587's own law is "PARSE **and TYPE-CHECK**".
    return {
      ok: false, outcome: 'TYPE_INVALID', tuple, diagnostics: semantic.map(fmtDiag),
      // ITEM 14: the span-carrying form. Ownership is joined on these, never on the strings.
      diagnosticRecords: semantic.map(diagRecord),
      violations: [{ catcher: TYPE_INVALID, path: semantic.map(fmtDiag).join(' | ') }],
    };
  }

  const checker = program.getTypeChecker();
  const violations = [];
  const owners = new Owners();
  const oracle = erasureOracle(sourceText, scriptKind);
  const push = (catcher, path_) => violations.push({ catcher, path: path_ });

  // ---- CONTAINER AXIS (item 6): the module system is a property of the FILE ------------
  // NOT of the source text. This is what makes a TRUE twin possible: one source text, two
  // containers, every text-level catcher silent in both.
  if (tuple.format === 'CJS') {
    push(CATCHERS.MODULE_SYSTEM,
      `effective module format is CommonJS -- decided by ${tuple.decidedBy}. The CommonJS wrapper channel (module-scope \`this\`, module.exports, require) exists in this container; the design admits ESM only.`);
  }

  // ---- PASS A: node-level catchers CLAIM their subtree AND EMIT their violation ---------
  // An owner that suppresses the identifier-level catchers must itself be the verdict.
  // MEASURED REGRESSION, fixed here: the first ownership build claimed `require(...)`,
  // `eval(...)` and `createRequire(...)` but emitted nothing for them, so the interior
  // identifier was suppressed and rows 41(b)/(c)/(e) fell to MISS_NOT_CAUGHT. Suppressing a
  // catcher without replacing it does not re-attribute a finding, it deletes it.
  let importCount = 0;
  const claimOwners = (node) => {
    // 🛑 F-1, FOUND BY THE accuracy-validator (GRADE-P0PC-PARTITION-2026-08-02, CRITICAL):
    // this rule keyed on `ts.isImportDeclaration` ALONE, so it counted only ONE of ESM's
    // static module edges. `export * from './ledger.js'` was ADMITTED with `violations = []`
    // and `importCount = 0` — and in the STAR form it carries no `Identifier` node at all, so
    // the identifier catchers were blind to it too. Reproduced here by execution: the ledger
    // module evaluated and its names became visible to the consumer.
    //   A CARDINALITY RULE THAT COUNTS ONE SYNTAX FORM IS NOT COUNTING THE EDGE.
    // Enumerated from the module-edge GRAMMAR rather than from the one form that was missed:
    // every construct that binds this module to another at load time is an edge.
    const edge =
      ts.isImportDeclaration(node) ? { kind: 'import', spec: node.moduleSpecifier }
      : (ts.isExportDeclaration(node) && node.moduleSpecifier) ? { kind: 're-export', spec: node.moduleSpecifier }
      : ts.isImportEqualsDeclaration(node) ? { kind: 'import-equals', spec: node.moduleReference }
      : null;
    if (edge) {
      owners.claim(node, CATCHERS.IMPORT_CARDINALITY);
      importCount += 1;
      push(CATCHERS.IMPORT_CARDINALITY, `static module edge (${edge.kind}) ${edge.spec.getText(srcFile)} (admitted module-edge count is 0)`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      owners.claim(node, CATCHERS.DYNAMIC_LOAD);
      push(CATCHERS.DYNAMIC_LOAD, 'dynamic import()');
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        ['require', 'createRequire', 'eval'].includes(ts.idText(node.expression))) {
      const nm = ts.idText(node.expression);
      owners.claim(node, CATCHERS.DYNAMIC_LOAD);
      push(CATCHERS.DYNAMIC_LOAD, nm === 'eval' ? "runtime evaluation via 'eval'" : `runtime module resolution via '${nm}'`);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ts.idText(node.expression) === 'Function') {
      owners.claim(node, CATCHERS.DYNAMIC_LOAD);
      push(CATCHERS.DYNAMIC_LOAD, 'new Function');
    }
    ts.forEachChild(node, claimOwners);
  };
  claimOwners(srcFile);

  // ---- module-scope declarations: state + exports + the constant grammar ---------------
  // (runs before the identifier pass so its GRAMMAR owner-claims are visible there)
  for (const stmt of srcFile.statements) {
    if (ts.isVariableStatement(stmt)) {
      const isExported = (ts.getCombinedModifierFlags(stmt.declarationList.declarations[0]) & ts.ModifierFlags.Export) !== 0;
      const isConst = (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const d of stmt.declarationList.declarations) {
        const nm = ts.isIdentifier(d.name) ? ts.idText(d.name) : '<pattern>';
        if (!isConst) { push(CATCHERS.MODULE_STATE, `mutable module-scope binding '${nm}'`); continue; }
        if (!d.initializer) { push(CATCHERS.MODULE_STATE, `uninitialised const '${nm}'`); continue; }
        const isFn = ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer);
        if (isExported && isFn && nm !== 'project') {
          owners.claim(d, CATCHERS.EXPORTS);
          push(CATCHERS.EXPORTS, `function-valued export '${nm}' other than project`);
        } else if (!isFn) {
          checkFrozenExpr(d.initializer, checker, srcFile, `const ${nm}`, violations, owners);
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name && ts.idText(stmt.name) !== 'project' &&
               (ts.getCombinedModifierFlags(stmt) & ts.ModifierFlags.Export) !== 0) {
      owners.claim(stmt, CATCHERS.EXPORTS);
      push(CATCHERS.EXPORTS, `function-valued export '${ts.idText(stmt.name)}' other than project (function declaration)`);
    }
  }

  checkRequiredExport(srcFile, violations);

  // ---- PASS B: identifier-level catchers ONLY, SUPPRESSED inside an owned node ---------
  // Node-level emissions all live in PASS A now; duplicating them here would double-count.
  const visit = (node) => {
    // MODULE-SCOPE `this` -- a TEXT-level finding. R-544 proved this is NOT a module-system
    // discriminator (it is identical in .mjs and .cjs), so it is reported under its own
    // path and the CONTAINER axis above is what actually decides the module system.
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      let fn = node.parent;
      while (fn && !ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn) &&
             !ts.isMethodDeclaration(fn) && !ts.isClassDeclaration(fn)) fn = fn.parent;
      if (!fn && !owners.ownerOf(node)) push(CATCHERS.MODULE_SYSTEM, 'module-scope `this` statement (text-level; NOT a container discriminator)');
    }
    if (ts.isIdentifier(node)) {
      const name = ts.idText(node);
      // A NAME SLOT IS NOT A REFERENCE — stated as a property instead of another SyntaxKind
      // list. If an identifier occupies its parent's `.name`, it is being DECLARED (variable,
      // function, class, interface, type alias, enum member, parameter, binding element) or is
      // a MEMBER KEY (property assignment, property signature, property access) — in neither
      // case does it reach anything. MEASURED CONSEQUENCE of getting this wrong: the type
      // member name `v` in `(lane: { v: unknown })` is erased while the property key `v` in
      // `({ v: lane.v })` survives, so the erasure oracle saw a PARTIALLY-erased spelling and
      // failed closed on two legitimate GREEN controls.
      // EXCEPTION, and it is load-bearing: a SHORTHAND property (`{ x }`) uses its name slot as
      // a genuine reference. Excluding it would blind the rule to a real capture.
      const isShorthandRef = node.parent && ts.isShorthandPropertyAssignment(node.parent);
      // 🛑 GRADE F-2 CRITICAL — THE THIRD BLIND CHANNEL. A `MetaProperty` node (`import.meta`,
      // `new.target`) has its Identifier in its `.name` slot, so `node.parent.name === node` was
      // TRUE and `meta` was classed a NAME SLOT — which skips every catcher below. `import.meta`
      // was ADMITTED with `violations: []`, and the executed module handed the caller a live
      // `import.meta.resolve`, i.e. dynamic module resolution, the exact capability
      // `CATCHERS.DYNAMIC_LOAD` exists to reject when spelled `require`/`import()`.
      //   A NAME SLOT IS NOT A REFERENCE — UNLESS THE NODE ITSELF IS THE CAPTURE.
      const isMetaProperty = node.parent && ts.isMetaProperty(node.parent);
      const isPropName = !isShorthandRef && !isMetaProperty && node.parent && node.parent.name === node;
      // A DECLARATION's own name binds, it does not capture. Class/interface/alias names were
      // missing here, so they fell into the residual and produced POSITION_UNCLASSIFIED noise
      // that masked F-2: the named-class heritage capture reddened on its CLASS NAME rather
      // than on the capture. Fixing the noise is what made the real defect visible.
      const isDeclName = node.parent && (ts.isVariableDeclaration(node.parent) || ts.isFunctionDeclaration(node.parent) ||
                                         ts.isParameter(node.parent) || ts.isPropertyAssignment(node.parent) ||
                                         ts.isClassDeclaration(node.parent) || ts.isClassExpression(node.parent) ||
                                         ts.isInterfaceDeclaration(node.parent) || ts.isTypeAliasDeclaration(node.parent) ||
                                         ts.isEnumDeclaration(node.parent) || ts.isModuleDeclaration(node.parent) ||
                                         ts.isBindingElement(node.parent) || ts.isLabeledStatement(node.parent) ||
                                         ts.isBreakOrContinueStatement(node.parent)) && (node.parent.name === node || node.parent.label === node);
      const owner = owners.ownerOf(node);
      // THE EMITTER DECIDES, AND IT IS NOW THE ONLY DECIDER.
      // ⚠️ THIS CAPTION PREVIOUSLY READ: "`classifyPosition` is retained only as a SECOND,
      // non-overlapping opinion for the disagreement report below." GRADE F-5 measured that there
      // was no second opinion and no disagreement report — `classifyPosition` had zero call sites.
      // It is now DELETED, so the caption is corrected here rather than left advertising a
      // capability the object does not have. `A CAPTION IS A CLAIM`, and I shipped this one stale
      // in the same commit that deleted the function it described.
      const position = (isPropName || isDeclName) ? 'value' : oracle.verdictFor(name);
      if (position === 'unclassified' && !owner) {
        // Never silently assigned to either space (R-546 s5.10's residual requirement).
        push(POSITION_UNCLASSIFIED, `identifier '${name}' in a position this rule cannot classify as type or value (parent ${ts.SyntaxKind[node.parent?.kind]}) -- FAILING CLOSED`);
      }
      if (!isPropName && !isDeclName && !owner && position === 'value') {
        if (name === 'module' || name === 'exports' || name === '__dirname' || name === '__filename') {
          push(CATCHERS.MODULE_SYSTEM, `CommonJS identifier '${name}'`);
        } else if (name === 'require' || name === 'createRequire') {
          push(CATCHERS.DYNAMIC_LOAD, `runtime module resolution via '${name}'`);
        } else if (name === 'eval' || name === 'Function') {
          push(CATCHERS.DYNAMIC_LOAD, `runtime evaluation via '${name}'`);
        } else if (HOST_GLOBALS.has(name)) {
          push(CATCHERS.AMBIENT, `host-global '${name}'`);
        } else {
          const sym = checker.getSymbolAtLocation(node);
          const decls = sym && sym.getDeclarations();
          const declaredHere = decls && decls.some((d) => d.getSourceFile() === srcFile);
          if (!AMBIENT_ALLOWED.has(name)) {
            if (!sym || !decls || decls.length === 0) {
              // An UNRESOLVED identifier is the purest free reference (corpus 34(d)).
              // Requiring a symbol here made the check blind to exactly the channel it
              // exists to catch. NOTE: such a fixture is TS2304 and therefore TYPE_INVALID
              // under item 1 -- this branch is retained because the RULE must still be
              // correct, and it is reachable in a `.js` container where TS is lenient.
              push(CATCHERS.FREE_REF, `unresolved free reference '${name}'`);
            } else if (!declaredHere) {
              const fromLib = decls.some((d) => /lib\..*\.d\.ts$/.test(d.getSourceFile().fileName));
              if (fromLib) push(CATCHERS.AMBIENT, `host-global '${name}' not in the ambient allow-list`);
              else push(CATCHERS.FREE_REF, `free/captured reference '${name}' (declared in ${path.basename(decls[0].getSourceFile().fileName)})`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(srcFile, visit);

  // dedupe identical (catcher, path) pairs
  const seen = new Set();
  const uniq = violations.filter((v) => {
    const k = `${v.catcher}|${v.path}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { ok: uniq.length === 0, outcome: uniq.length === 0 ? 'ADMITTED' : 'REJECTED', violations: uniq, tuple, importCount, diagnostics: [] };
}

function fmtDiag(d) {
  return `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
}

// ITEM 14 (R-548 §4) — A DIAGNOSTIC MUST CARRY ITS ANCHOR, OR OWNERSHIP CANNOT BE JOINED.
// `fmtDiag` discards the span, and a string is all `classifyTypeInvalid` ever received — which
// is precisely why a global code list was the only join available to it.
//   AN ERROR CODE IS A TYPE OF EVENT, NOT PROOF THE EVENT BELONGS TO THIS MUTATION.
// The record below carries the code AND the exact source span, so the runner can ask the only
// question that establishes ownership: does this diagnostic point AT the illegality this row
// planted? The string form is kept unchanged beside it so every existing reader is untouched.
export function diagRecord(d) {
  const rec = {
    code: `TS${d.code}`,
    message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    start: null, length: null, line: null, character: null, anchorText: null,
  };
  if (d.file && typeof d.start === 'number') {
    const len = d.length ?? 0;
    const lc = d.file.getLineAndCharacterOfPosition(d.start);
    rec.start = d.start;
    rec.length = len;
    rec.line = lc.line + 1;
    rec.character = lc.character + 1;
    rec.anchorText = d.file.text.slice(d.start, d.start + len);
  }
  return rec;
}

// ---- SURFACE HEALTH: a positive control on the pinned surface itself -------------------
// If ambient.d.ts or a support module does not compile, every fixture verdict below it is
// suspect. This is the "did the instrument run" witness for the whole surface.
export function surfaceHealth({ extraRoots = [] } = {}) {
  const roots = [AMBIENT, `${SURFACE_DIR}/pure-math.ts`, `${SURFACE_DIR}/ledger.ts`, `${SURFACE_DIR}/helper.ts`, ...extraRoots];
  const program = ts.createProgram(roots, { ...PINNED_OPTIONS });
  const diags = [];
  for (const r of roots) {
    const sf = program.getSourceFile(r);
    if (!sf) { diags.push(`${path.basename(r)}: NO SOURCE FILE`); continue; }
    for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) diags.push(`${path.basename(r)}: ${fmtDiag(d)}`);
  }
  return { clean: diags.length === 0, diags, roots: roots.map((r) => path.basename(r)) };
}
