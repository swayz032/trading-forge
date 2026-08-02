// 1b-S — BUILD-TIME SOURCE ADMISSION for project()'s module.
// Mechanism: TypeScript compiler API AST (NOT regex, NOT getText, NOT a token scan).
// Every rejection returns { catcher, path } so a verdict can be attributed to the rule
// that actually fired — the design's VALIDITY-BEFORE-VERDICT / wrong-catcher law.
//
// SEPARABILITY: this module reads module SOURCE TEXT only. It never opens the ledger
// or ORACLE.json. (Asserted by measurement in the results artifact, not by claim.)
import ts from 'typescript';

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

// The ambient-intrinsic allow-list: membership 1, resolved by SYMBOL, not by text.
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

// The admitted constant grammar:
//   Frozen := Object.freeze( ObjLit | ArrLit ) | Primitive
function checkFrozenExpr(expr, checker, srcFile, path, out) {
  if (
    expr.kind === ts.SyntaxKind.StringLiteral ||
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword ||
    expr.kind === ts.SyntaxKind.NullKeyword
  ) return;
  if (ts.isNumericLiteral(expr)) {
    if (!Number.isFinite(Number(expr.text))) out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: non-finite numeric` });
    return;
  }
  if (ts.isPrefixUnaryExpression(expr) && ts.isNumericLiteral(expr.operand)) return; // -1

  if (ts.isCallExpression(expr)) {
    if (!isIntrinsicFreezeCallee(expr.expression, checker, srcFile)) {
      out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: non-intrinsic callee '${expr.expression.getText(srcFile)}'` });
      return;
    }
    const arg = expr.arguments[0];
    if (!arg) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: Object.freeze() with no argument` }); return; }
    if (ts.isObjectLiteralExpression(arg)) return checkObjLit(arg, checker, srcFile, path, out);
    if (ts.isArrayLiteralExpression(arg)) return checkArrLit(arg, checker, srcFile, path, out);
    out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: Object.freeze of a non-literal` });
    return;
  }
  if (ts.isObjectLiteralExpression(expr) || ts.isArrayLiteralExpression(expr)) {
    out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: unwrapped literal (every nested literal needs its own Object.freeze)` });
    return;
  }
  if (ts.isIdentifier(expr)) {
    out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: alias of identifier '${ts.idText(expr)}'` });
    return;
  }
  out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: disallowed expression form ${ts.SyntaxKind[expr.kind]}` });
}

function checkObjLit(obj, checker, srcFile, path, out) {
  const seen = new Map();
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: spread` }); continue; }
    if (ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) ||
        ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p)) {
      out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: accessor/method/shorthand property` }); continue;
    }
    if (!ts.isPropertyAssignment(p)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: unsupported property form` }); continue; }
    if (ts.isComputedPropertyName(p.name)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: computed key` }); continue; }
    if (ts.isNumericLiteral(p.name)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: numeric key` }); continue; }
    const k = cooked(p.name);
    if (k === null) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}: uncookable key` }); continue; }
    if (k === '__proto__') { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}.${k}: __proto__ prototype setter (cooked)` }); continue; }
    if (seen.has(k)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}.${k}: duplicate cooked key` }); continue; }
    seen.set(k, true);
    checkFrozenExpr(p.initializer, checker, srcFile, `${path}.${k}`, out);
  }
}

function checkArrLit(arr, checker, srcFile, path, out) {
  arr.elements.forEach((el, i) => {
    if (el.kind === ts.SyntaxKind.OmittedExpression) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}[${i}]: sparse hole` }); return; }
    if (ts.isSpreadElement(el)) { out.push({ catcher: CATCHERS.GRAMMAR, path: `${path}[${i}]: spread` }); return; }
    checkFrozenExpr(el, checker, srcFile, `${path}[${i}]`, out);
  });
}

/**
 * @returns {{ ok: boolean, violations: {catcher: string, path: string}[], parseOk: boolean }}
 */
export function admitSource(fileName, sourceText) {
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts'],
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, ...rest) =>
    name === fileName
      ? ts.createSourceFile(name, sourceText, lang, true, ts.ScriptKind.TS)
      : orig(name, lang, ...rest);
  host.fileExists = (n) => (n === fileName ? true : ts.sys.fileExists(n));
  host.readFile = (n) => (n === fileName ? sourceText : ts.sys.readFile(n));

  const program = ts.createProgram([fileName], compilerOptions, host);
  const srcFile = program.getSourceFile(fileName);
  const violations = [];

  // ---- VALIDITY BEFORE VERDICT: the fixture must PARSE before any verdict is admitted.
  const syntactic = program.getSyntacticDiagnostics(srcFile);
  if (syntactic.length > 0) {
    return { ok: false, parseOk: false, violations: [{ catcher: 'PARSE_ERROR', path: ts.flattenDiagnosticMessageText(syntactic[0].messageText, ' ') }] };
  }
  const checker = program.getTypeChecker();

  let importCount = 0;
  const push = (catcher, path) => violations.push({ catcher, path });

  const visit = (node) => {
    // ---- MODULE SYSTEM (G-1): the CJS wrapper `this` is a ThisExpression, not a binding.
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      let fn = node.parent;
      while (fn && !ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn) &&
             !ts.isMethodDeclaration(fn) && !ts.isClassDeclaration(fn)) fn = fn.parent;
      if (!fn) push(CATCHERS.MODULE_SYSTEM, 'module-scope `this` (CommonJS wrapper object)');
    }
    if (ts.isIdentifier(node)) {
      const name = ts.idText(node);
      const isPropName = node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const isDeclName = node.parent && (ts.isVariableDeclaration(node.parent) || ts.isFunctionDeclaration(node.parent) ||
                                         ts.isParameter(node.parent) || ts.isPropertyAssignment(node.parent)) && node.parent.name === node;
      if (!isPropName && !isDeclName) {
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
          const isIntrinsicAllow = AMBIENT_ALLOWED.has(name);
          if (!isIntrinsicAllow) {
            if (!sym || !decls || decls.length === 0) {
              // An UNRESOLVED identifier is the purest free reference: nothing in this module
              // declares it and no lib declares it. Requiring a symbol here made the check
              // blind to exactly the channel it exists to catch (corpus 34(d)).
              push(CATCHERS.FREE_REF, `unresolved free reference '${name}'`);
            } else if (!declaredHere) {
              const fromLib = decls.some((d) => /lib\..*\.d\.ts$/.test(d.getSourceFile().fileName));
              if (fromLib) push(CATCHERS.AMBIENT, `host-global '${name}' not in the ambient allow-list`);
              else push(CATCHERS.FREE_REF, `free/captured reference '${name}'`);
            }
          }
        }
      }
    }
    if (ts.isImportDeclaration(node)) {
      importCount += 1;
      push(CATCHERS.IMPORT_CARDINALITY, `import '${node.moduleSpecifier.getText(srcFile)}' (admitted import count is 0)`);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      push(CATCHERS.DYNAMIC_LOAD, 'dynamic import()');
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ts.idText(node.expression) === 'Function') {
      push(CATCHERS.DYNAMIC_LOAD, 'new Function');
    }
    ts.forEachChild(node, visit);
  };

  // ---- module-scope declarations: state + exports + the constant grammar
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
          push(CATCHERS.EXPORTS, `function-valued export '${nm}' other than project`);
        } else if (!isFn) {
          checkFrozenExpr(d.initializer, checker, srcFile, `const ${nm}`, violations);
        }
      }
    }
  }
  ts.forEachChild(srcFile, visit);

  // dedupe identical (catcher, path) pairs
  const seen = new Set();
  const uniq = violations.filter((v) => {
    const k = `${v.catcher}|${v.path}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  return { ok: uniq.length === 0, parseOk: true, violations: uniq, importCount };
}
