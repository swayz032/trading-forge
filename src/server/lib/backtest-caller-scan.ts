/**
 * G-1 — the backtest call-site SCANNER (R-772 §5).
 *
 * WHY THIS EXISTS, AND WHY A CENSUS WAS NOT ENOUGH:
 * a census proves the present state (14 callers, today). This proves a FUTURE
 * property — a new production caller of `runBacktest()` must make the build RED
 * until its refusal disposition is explicitly registered.
 *   A CENSUS IS A PHOTOGRAPH; A GUARD IS A RATCHET.   (R-772 §3)
 *
 * MECHANISM: the TypeScript compiler API (typescript@5.9.3, already resolved —
 * no new dependency). AST rather than regex, and the reason is contract clause B:
 * the identity must be `file + enclosing production function + invocation identity`
 * with NO LINE NUMBERS, and it must survive a pure reformat of a caller file.
 * A regex cannot name the enclosing function reliably, and any offset-based key it
 * produced would be line-pinning wearing a different key.
 *
 * The AST also removes, by construction rather than by filtering, the three things
 * a text scan gets wrong here: the `export async function runBacktest` DEFINITION
 * (a declaration, not a call), the 6 doc-comment mentions, and any occurrence
 * inside a string literal.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

/** The callee this guard watches. */
export const GUARDED_CALLEE = "runBacktest";

/**
 * A caller's stable identity. NO LINE NUMBERS — see clause B.
 *
 * `ordinal` disambiguates repeated calls inside ONE function (critic-optimizer
 * has four). It is the index in source order among guarded calls in that same
 * enclosing function, so a pure reformat cannot move it, while ADDING a call to
 * an already-registered function correctly reddens the guard.
 */
export interface CallerIdentity {
  file: string;
  fn: string;
  ordinal: number;
}

export function identityKey(c: CallerIdentity): string {
  return `${c.file}::${c.fn}#${c.ordinal}`;
}

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "__tests__", "coverage"]);

function isProductionSource(file: string): boolean {
  if (!file.endsWith(".ts") && !file.endsWith(".tsx")) return false;
  if (file.endsWith(".d.ts")) return false;
  if (file.includes(".test.") || file.includes(".spec.")) return false;
  return true;
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walkFiles(full, out);
    } else if (isProductionSource(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The nearest ENCLOSING NAMED function/method. Anonymous callbacks walk further
 * up rather than producing an unstable synthetic name, so a call inside
 * `items.map(x => runBacktest(...))` is attributed to the named function that
 * contains it — which is the boundary a reviewer actually owns.
 */
function enclosingFunctionName(node: ts.Node): string {
  // A NAMED enclosing function always wins. A callback handed to `.then()` or
  // `.map()` inside `runStrategy()` belongs to `runStrategy` — that is the
  // boundary a reviewer owns, and it is the one that stays stable.
  // Only when nothing named encloses the call at all (an anonymous route handler
  // registered at module scope) do we fall back to naming the registration that
  // installed it, which beats `<module-scope>` for both precision and stability.
  let fallback: string | undefined;
  let cur: ts.Node | undefined = node.parent;

  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.getText();
    if (ts.isMethodDeclaration(cur) && cur.name) return cur.name.getText();
    if ((ts.isFunctionExpression(cur) || ts.isArrowFunction(cur)) && cur.parent) {
      const p = cur.parent;
      if (ts.isVariableDeclaration(p) && p.name) return p.name.getText();
      if (ts.isPropertyAssignment(p) && p.name) return p.name.getText();
      if (ts.isPropertyDeclaration(p) && p.name) return p.name.getText();
      if (ts.isCallExpression(p) && fallback === undefined) {
        const callee = p.expression.getText();
        const lit = p.arguments.find((a): a is ts.StringLiteral => ts.isStringLiteral(a));
        fallback = lit ? `${callee}(${lit.text})` : callee;
      }
    }
    if (ts.isClassDeclaration(cur) && cur.name) return cur.name.getText();
    cur = cur.parent;
  }
  return fallback ?? "<module-scope>";
}

function isGuardedCall(node: ts.CallExpression): boolean {
  const e = node.expression;
  if (ts.isIdentifier(e)) return e.text === GUARDED_CALLEE;
  if (ts.isPropertyAccessExpression(e)) return e.name.text === GUARDED_CALLEE;
  return false;
}

/**
 * Scan a production tree for guarded call sites. Deterministic and sorted, so two
 * runs on an unchanged tree produce byte-identical output.
 */
export function scanBacktestCallers(repoRoot: string, scanRoot = "src"): CallerIdentity[] {
  const base = join(repoRoot, scanRoot);
  const found: CallerIdentity[] = [];

  for (const file of walkFiles(base).sort()) {
    const text = readFileSync(file, "utf8");
    // A cheap pre-filter ONLY — the AST below is what decides. Skipping files that
    // cannot contain the token is a speed choice, never a correctness one.
    if (!text.includes(GUARDED_CALLEE)) continue;

    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = relative(repoRoot, file).split(sep).join("/");
    const perFn = new Map<string, number>();

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isGuardedCall(node)) {
        const fn = enclosingFunctionName(node);
        const ordinal = perFn.get(fn) ?? 0;
        perFn.set(fn, ordinal + 1);
        found.push({ file: rel, fn, ordinal });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return found.sort((a, b) => identityKey(a).localeCompare(identityKey(b)));
}

/** The audit verdict. `ok` is the guard's whole answer; the rest is why. */
export interface CallerAuditResult {
  observedCount: number;
  registryCount: number;
  /** Observed but NOT registered — clause C, unknown fails closed. */
  unregistered: string[];
  /** Registered but NOT observed — clause D, and §4's empty-scan catcher. */
  missing: string[];
  /** Entries lacking an explicit refusal disposition — clause E. */
  undispositioned: string[];
  ok: boolean;
  violations: string[];
}

const VALID_DISPOSITIONS = new Set(["HANDLES_REFUSAL", "PROPAGATES", "DISCARDS"]);

/**
 * Compare the observed world against the approved registry BY MEMBERSHIP, BOTH
 * DIRECTIONS (clause A). Cardinality is deliberately never the assertion: a
 * delete-one + add-one preserves the count and must still go RED.
 */
export function auditBacktestCallers(
  observed: readonly CallerIdentity[],
  registry: readonly { file: string; fn: string; ordinal: number; disposition?: string }[],
): CallerAuditResult {
  const observedKeys = new Set(observed.map(identityKey));
  const registryKeys = new Set(registry.map(identityKey));

  const unregistered = [...observedKeys].filter((k) => !registryKeys.has(k)).sort();
  const missing = [...registryKeys].filter((k) => !observedKeys.has(k)).sort();
  const undispositioned = registry
    .filter((e) => !e.disposition || !VALID_DISPOSITIONS.has(e.disposition))
    .map(identityKey)
    .sort();

  const violations: string[] = [];

  // §4 THE EMPTY-SCAN ARM, as its own explicit refusal rather than as a corollary.
  // A scanner whose matcher silently breaks observes ZERO callers, and if the
  // registry were ever emptied too, membership would MATCH and the guard would go
  // green over an empty world.
  //   "ZERO UNKNOWN CALLERS" AND "ZERO CALLERS" MUST NOT PRODUCE THE SAME VERDICT.
  if (observed.length === 0) {
    violations.push(
      "EMPTY SCAN: the scanner observed ZERO backtest callers. Either the matcher is " +
        "broken or the scan root is wrong. This is never a pass.",
    );
  }
  if (registry.length === 0) {
    violations.push("EMPTY REGISTRY: the approved-caller registry is empty. This is never a pass.");
  }
  for (const k of unregistered) {
    violations.push(
      `UNREGISTERED CALLER (fails closed, no default disposition): ${k} — ` +
        "a new production caller of runBacktest() must declare how it disposes of an " +
        "engine refusal before this guard can go green.",
    );
  }
  for (const k of missing) {
    violations.push(
      `APPROVED CALLER NOT OBSERVED: ${k} — it was removed, renamed, or the scanner no ` +
        "longer sees it. Remove the registry entry deliberately if the removal was intended.",
    );
  }
  for (const k of undispositioned) {
    violations.push(`NO EXPLICIT REFUSAL DISPOSITION: ${k}`);
  }

  return {
    observedCount: observed.length,
    registryCount: registry.length,
    unregistered,
    missing,
    undispositioned,
    ok: violations.length === 0,
    violations,
  };
}
