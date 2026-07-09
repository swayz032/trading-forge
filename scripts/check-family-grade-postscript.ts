/**
 * CI Lint: Family-Grade Postscript Audit — STRICT / whole-tree (deep-scan #22 Track X1)
 *
 * Every operator-facing critical/warning alert must carry a plain-English family postscript so a
 * non-technical family member paged on Discord knows what happened and what to do.  The wrapper is
 * `appendFamilyGradePostscript(operatorBody, plainEnglishWhat, plainEnglishAction)`
 * (src/server/lib/notification-helpers.ts).
 *
 * ── Why this was rewritten ─────────────────────────────────────────────────────────────────────
 * The PRIOR implementation was a line-window HEURISTIC over 48 HAND-LISTED files: for each
 * `notify*(` line it scanned ±N raw lines for the substring `appendFamilyGradePostscript`.  Two
 * structural weaknesses:
 *   1. SCOPE — only 48 files were audited; any `notify*` call in the other ~380 server files was
 *      invisible.  A real bare `notifyCritical` outside the list shipped unnoticed.
 *   2. STRICTNESS — a raw-text window match is fooled by an unrelated mention of the wrapper name
 *      within the window, and (conversely) a legitimate wrap via an IMPORT ALIAS
 *      (`const { appendFamilyGradePostscript: appendFGP } = await import(...)`) was invisible to a
 *      literal substring scan, producing false positives.
 *
 * ── This version ───────────────────────────────────────────────────────────────────────────────
 * Parses EVERY server .ts file (src/server, recursive; excluding tests + .d.ts) with the
 * finds every `notifyCritical(` / `notifyWarning(` CALL EXPRESSION (function DEFINITIONS are not
 * calls, so the wrapper definitions are naturally excluded), and verifies the call is family-grade
 * wrapped by one of three STRUCTURAL means:
 *   (a) direct   — an argument subtree contains a call to `appendFamilyGradePostscript` OR any of
 *                  its resolved import/destructure aliases in that file;
 *   (b) indirect — an argument is an identifier bound in that file from a wrapper call
 *                  (`const body = appendFGP(...); notifyCritical(title, body, meta)`);
 *   (c) sentinel — an argument literally contains the family sentinel "--- For family members ---".
 *
 * Run:  node node_modules/tsx/dist/cli.mjs scripts/check-family-grade-postscript.ts
 * Exit 0: every server-side notify call is family-grade wrapped.
 * Exit 1: one or more unwrapped sites (file:line printed).
 *
 * Test hook: TF_FGP_SCAN_ROOT overrides the scan root (absolute dir) — the failure-injection test
 *            points it at a temp fixture tree to prove RED on an unwrapped notifyCritical.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const WRAPPER_CANONICAL = "appendFamilyGradePostscript";
const FAMILY_SENTINEL = "--- For family members ---";
const NOTIFY_NAMES = new Set(["notifyCritical", "notifyWarning"]);

export interface Offender {
  file: string; // repo-relative
  line: number; // 1-based
  callee: string;
  source: string;
}

function parse(src: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
}

/** All local names in a file that alias `appendFamilyGradePostscript` (static import + destructure). */
export function resolveWrapperAliases(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>([WRAPPER_CANONICAL]);
  const visit = (node: ts.Node): void => {
    // static: import { appendFamilyGradePostscript as X } / import { appendFamilyGradePostscript }
    if (ts.isImportSpecifier(node)) {
      const original = node.propertyName?.text ?? node.name.text;
      if (original === WRAPPER_CANONICAL) names.add(node.name.text);
    }
    // dynamic destructure: const { appendFamilyGradePostscript: X } = await import(...)
    //                  or  .then(({ appendFamilyGradePostscript: X }) => ...)
    if (ts.isBindingElement(node)) {
      const original =
        node.propertyName && (ts.isIdentifier(node.propertyName) || ts.isStringLiteralLike(node.propertyName))
          ? node.propertyName.text
          : ts.isIdentifier(node.name)
            ? node.name.text
            : undefined;
      if (original === WRAPPER_CANONICAL && ts.isIdentifier(node.name)) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

/** Local variable names bound from a wrapper call (`const body = appendFGP(...)`, `x = appendFGP(...)`). */
export function resolveWrapperBoundVars(sf: ts.SourceFile, wrapperNames: Set<string>): Set<string> {
  const vars = new Set<string>();
  const subtreeHasWrapperCall = (node: ts.Node): boolean => {
    let hit = false;
    const walk = (n: ts.Node): void => {
      if (hit) return;
      if (ts.isCallExpression(n)) {
        const callee = n.expression;
        const nm = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
        if (wrapperNames.has(nm)) {
          hit = true;
          return;
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return hit;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)) {
      if (subtreeHasWrapperCall(node.initializer)) vars.add(node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      if (subtreeHasWrapperCall(node.right)) vars.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return vars;
}

function argIsWrapped(arg: ts.Node, wrapperNames: Set<string>, boundVars: Set<string>, sf: ts.SourceFile): boolean {
  // (b) indirect const/var
  if (ts.isIdentifier(arg) && boundVars.has(arg.text)) return true;
  // (a) direct wrapper call anywhere in the arg subtree
  let hit = false;
  const walk = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const nm = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (wrapperNames.has(nm)) {
        hit = true;
        return;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(arg);
  if (hit) return true;
  // (c) inline family sentinel
  if (arg.getText(sf).includes(FAMILY_SENTINEL)) return true;
  return false;
}

export function checkFileSource(src: string, relPath: string): Offender[] {
  const sf = parse(src, relPath);
  const wrapperNames = resolveWrapperAliases(sf);
  const boundVars = resolveWrapperBoundVars(sf, wrapperNames);
  const offenders: Offender[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const nm = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (NOTIFY_NAMES.has(nm)) {
        const wrapped = node.arguments.some((a) => argIsWrapped(a, wrapperNames, boundVars, sf));
        if (!wrapped) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          offenders.push({
            file: relPath,
            line: line + 1,
            callee: nm,
            source: node.getText(sf).split("\n")[0]!.trim().slice(0, 120),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return offenders;
}

function walkTsFiles(dir: string, root: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      walkTsFiles(p, root, acc);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.endsWith(".d.ts")) {
      acc.push(p);
    }
  }
  return acc;
}

export function checkTree(serverDir: string): Offender[] {
  const files = walkTsFiles(serverDir, serverDir);
  const offenders: Offender[] = [];
  for (const full of files) {
    const rel = path.relative(path.dirname(serverDir), full).replace(/\\/g, "/");
    offenders.push(...checkFileSource(fs.readFileSync(full, "utf8"), rel));
  }
  return offenders;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────

function isMain(): boolean {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const scanRoot = process.env.TF_FGP_SCAN_ROOT
    ? path.resolve(process.env.TF_FGP_SCAN_ROOT)
    : path.resolve(here, "..", "src", "server");

  console.log(`[check-family-grade-postscript] AST scan of ${scanRoot} for unwrapped notify calls...`);
  const offenders = checkTree(scanRoot);

  if (offenders.length === 0) {
    console.log(
      "[check-family-grade-postscript] PASS — every notifyCritical/notifyWarning call in src/server is family-grade wrapped.",
    );
    process.exit(0);
  }

  console.error(`[check-family-grade-postscript] FAIL — ${offenders.length} unwrapped notify call site(s):\n`);
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  (${o.callee})`);
    console.error(`    ${o.source}`);
  }
  console.error(
    `\n  Wrap each message body: notify${"X"}('title', appendFamilyGradePostscript('technical', 'family what', 'family action'), meta)`,
  );
  process.exit(1);
}
