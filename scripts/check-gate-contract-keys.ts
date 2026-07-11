/**
 * check:gate-contract-keys — deep-scan Paper F-1 (persisting HIGH, flagged across 3 audits).
 *
 * The promotion hard gates read their inputs from JSONB blobs by string key:
 *   - walk_forward_metadata.wfe_overall / .pbo_overall   (wfe-gate / pbo-gate)
 *   - monte_carlo probability_of_ruin_ci.ci_high          (b14-ci-gate)
 *   - backtests.bif / .k_eff                              (bif-gate)
 *   - backtests.b15Battery.passed                         (b15 robustness)
 *   - strategies.frozen_policy_hash                       (frozen-policy drift gate)
 * A gate that reads a key which the producer has renamed gets `undefined` → the gate's legacy
 * fallback → a SILENT grandfather-PASS, with NO existing test failing. This is exactly the
 * producer→consumer silent-drift class that has bitten this project repeatedly.
 *
 * ── deep-scan #22 Track X1 (STRICT UPGRADE 2026-07-09) ─────────────────────────────────────
 * The PRIOR implementation word-boundary-matched the key TOKEN anywhere in the file text
 * (`new RegExp("\\b" + key + "\\b").test(src)`).  That is a REGEX CANARY, not a contract check:
 *   • the generic key `passed` matched ANY unrelated `passed` variable / `.passed` on a
 *     different object — so a producer rename of the b15 battery field would still pass;
 *   • a key mentioned only in a COMMENT or a LOG STRING satisfied the gate even though nothing
 *     actually READ it — so a real rename that left a stale doc-comment behind sailed through.
 *
 * This version is STRICT and structure-aware:
 *   • CONSUMER side (TypeScript) is parsed with the `typescript` compiler API.  A key counts as
 *     "read" ONLY at a real member-access site — `x.wfe_overall`, `obj["pbo_overall"]`,
 *     `rm?.probability_of_ruin_ci` — via `PropertyAccessExpression` / `ElementAccessExpression`
 *     AST nodes.  A bare identifier, a comment, or a string literal that merely CONTAINS the
 *     token does NOT count.  Import aliases are irrelevant on the read side (member names are
 *     not aliased).  For the generic `passed` surface the read must be ANCHORED to the b15
 *     battery object (`b15.passed` / `b15Battery.passed`) so an unrelated `.passed` cannot
 *     satisfy it.  For Drizzle-mapped columns the camelCase alias is accepted (see `camelAlias`).
 *   • PRODUCER side (Python or TS) must EMIT the key as a real dict/object key or subscript —
 *     `"wfe_overall": ...`, `results["probability_of_ruin_ci"] = ...`, `frozenPolicyHash: hash`.
 *     Python producers are scanned after stripping `#` comments AND triple-quoted docstrings, so
 *     a docstring mention (e.g. `probability_of_ruin_ci.ci_high` in prose) does NOT count.
 *
 * A rename on either side drops the key at its real structural site → CI fails LOUDLY, surfacing
 * the drift before it can silently disable a promotion gate on live-capital decisions.
 *
 * Run:      node node_modules/tsx/dist/cli.mjs scripts/check-gate-contract-keys.ts
 * Test hook: set TF_GATE_CONTRACT_OVERRIDE_JSON to a JSON array of surfaces (absolute paths) to
 *            run the gate against fixtures — used by the failure-injection test to prove RED.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import ts from "typescript";

/** A single producer→consumer key contract ("surface"). */
export interface GateSurface {
  /** Canonical wire / JSONB key (snake_case). */
  key: string;
  /** TS camelCase alias for Drizzle-mapped columns (read/written under this name on the TS side). */
  camelAlias?: string;
  /**
   * For a generic key (e.g. `passed`) the consumer read must be anchored to an object whose
   * expression text contains this token — prevents an unrelated `.passed` from satisfying it.
   */
  anchor?: string;
  /** Producer file (relative to repo root) + language of that file. */
  producer: { file: string; lang: "py" | "ts" };
  /** Consumer file (relative to repo root) — always TypeScript, read as a real member access. */
  consumer: { file: string };
}

export const GATE_CONTRACT: GateSurface[] = [
  // WFE — walk_forward.py emits "wfe_overall"; the PAPER→DEPLOY_READY gate reads wfr?.wfe_overall.
  {
    key: "wfe_overall",
    producer: { file: "src/engine/walk_forward.py", lang: "py" },
    consumer: { file: "src/server/lib/paper-to-deploy-ready-gates.ts" },
  },
  // PBO — walk_forward.py emits "pbo_overall"; pbo-gate.ts reads backtestResult.pbo_overall.
  {
    key: "pbo_overall",
    producer: { file: "src/engine/walk_forward.py", lang: "py" },
    consumer: { file: "src/server/lib/pbo-gate.ts" },
  },
  // B14 ruin CI — mc_confidence.py emits results["probability_of_ruin_ci"]; the gate reads
  // rm.probability_of_ruin_ci (then .ci_high).
  {
    key: "probability_of_ruin_ci",
    producer: { file: "src/engine/mc_confidence.py", lang: "py" },
    consumer: { file: "src/server/lib/paper-to-deploy-ready-gates.ts" },
  },
  // BIF — backtest_inflation_factor.py emits "bif"; backtest-service.ts reads result.bif.
  {
    key: "bif",
    producer: { file: "src/engine/statistics/backtest_inflation_factor.py", lang: "py" },
    consumer: { file: "src/server/services/backtest-service.ts" },
  },
  // K_eff — backtest_inflation_factor.py emits "k_eff"; backtest-service.ts reads result.k_eff.
  {
    key: "k_eff",
    producer: { file: "src/engine/statistics/backtest_inflation_factor.py", lang: "py" },
    consumer: { file: "src/server/services/backtest-service.ts" },
  },
  // B15 battery pass — parameter_jitter_battery.py emits the inner "passed"; the promotion gate
  // reads b15.passed (b15 = input.b15Battery).  ANCHORED to b15 so an unrelated .passed cannot
  // satisfy the gate (this is the exact false-match the regex canary allowed).
  {
    key: "passed",
    anchor: "b15",
    producer: { file: "src/engine/parameter_jitter_battery.py", lang: "py" },
    consumer: { file: "src/server/lib/paper-to-deploy-ready-gates.ts" },
  },
  // Frozen-policy hash — frozen-policy-contract.ts writes frozenPolicyHash (Drizzle column
  // frozen_policy_hash); lifecycle-service.ts reads strategies.frozenPolicyHash at the drift gate.
  {
    key: "frozen_policy_hash",
    camelAlias: "frozenPolicyHash",
    producer: { file: "src/server/lib/frozen-policy-contract.ts", lang: "ts" },
    consumer: { file: "src/server/services/lifecycle-service.ts" },
  },
];

// ─── AST primitives (TypeScript compiler API) ─────────────────────────────────────────────────

function parseTs(src: string, fileName = "surface.ts"): ts.SourceFile {
  return ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, /*setParentNodes*/ true, ts.ScriptKind.TS);
}

/** True iff `key` is read at a genuine member-access site: `x.key` or `obj["key"]`. */
export function tsReadsKeyAsMember(src: string, key: string): boolean {
  const sf = parseTs(src);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) && node.name.text === key) {
      found = true;
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === key
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** True iff `key` is read as `<expr>.key` / `<expr>["key"]` where <expr> text contains `anchor`. */
export function tsReadsAnchoredMember(src: string, anchor: string, key: string): boolean {
  const sf = parseTs(src);
  const anchorLc = anchor.toLowerCase();
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(node) && node.name.text === key) {
      if (node.expression.getText(sf).toLowerCase().includes(anchorLc)) {
        found = true;
        return;
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === key &&
      node.expression.getText(sf).toLowerCase().includes(anchorLc)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * True iff `key` is EMITTED on the TS producer side — as an object-literal property
 * (`frozenPolicyHash: hash` / shorthand `{ frozenPolicyHash }`), a member write, or an element
 * write.  Type-only positions still count (they document the emit contract structurally).
 */
export function tsEmitsKeyAsProperty(src: string, key: string): boolean {
  const sf = parseTs(src);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      node.name.text === key
    ) {
      found = true;
      return;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === key) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// ─── Python producer lexer (strip # comments + triple-quoted docstrings, then match key emit) ──

/** Replace `#` line comments and triple-quoted strings with spaces (length-preserving). */
export function stripPythonCommentsAndDocstrings(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  let inSingle = false; // '...'
  let inDouble = false; // "..."
  let inTriple: '"""' | "'''" | null = null;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < n) {
    const three = src.slice(i, i + 3);
    if (inTriple) {
      if (three === inTriple) {
        blank(i, i + 3);
        i += 3;
        inTriple = null;
        continue;
      }
      blank(i, i + 1);
      i++;
      continue;
    }
    if (inSingle || inDouble) {
      // inside a normal string — leave the KEY visible so "key": / ["key"] still match,
      // but we do NOT enter here for prose because prose lives in docstrings/comments which
      // are stripped above.  Handle escapes + termination.
      const c = src[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (inSingle && c === "'") inSingle = false;
      else if (inDouble && c === '"') inDouble = false;
      i++;
      continue;
    }
    // not in any string
    if (three === '"""' || three === "'''") {
      inTriple = three as '"""' | "'''";
      blank(i, i + 3);
      i += 3;
      continue;
    }
    const c = src[i];
    if (c === "#") {
      // line comment
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** True iff `key` is emitted in Python as a dict key `"key":` or a subscript `["key"]`. */
export function pyEmitsKey(src: string, key: string): boolean {
  const cleaned = stripPythonCommentsAndDocstrings(src);
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dictKey = new RegExp(`["']${k}["']\\s*:`); // "key": value
  const subscript = new RegExp(`\\[\\s*["']${k}["']\\s*\\]`); // obj["key"]
  return dictKey.test(cleaned) || subscript.test(cleaned);
}

// ─── Surface evaluation ────────────────────────────────────────────────────────────────────────

function readOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export interface SurfaceOpts {
  /** Repo root that relative surface paths resolve against (default: repo root of this script). */
  rootDir: string;
}

export function checkSurface(surface: GateSurface, opts: SurfaceOpts): string[] {
  const problems: string[] = [];
  const { key, camelAlias, anchor, producer, consumer } = surface;
  const producerPath = path.resolve(opts.rootDir, producer.file);
  const consumerPath = path.resolve(opts.rootDir, consumer.file);

  // ── producer ──
  const pSrc = readOrNull(producerPath);
  if (pSrc === null) {
    problems.push(`  [${key}] producer file missing: ${producer.file}`);
  } else {
    const emitted =
      producer.lang === "py"
        ? pyEmitsKey(pSrc, key)
        : // TS producer: prefer camelAlias emit form when defined (Drizzle-mapped column)
          tsEmitsKeyAsProperty(pSrc, camelAlias ?? key);
    if (!emitted) {
      problems.push(
        `  [${key}] NOT emitted at a real key site in producer ${producer.file} — ` +
          `gate-input key renamed on the producer side; the ${key} promotion gate would silently ` +
          `grandfather-PASS every strategy.`,
      );
    }
  }

  // ── consumer ──
  const cSrc = readOrNull(consumerPath);
  if (cSrc === null) {
    problems.push(`  [${key}] consumer file missing: ${consumer.file}`);
  } else {
    let read: boolean;
    if (anchor) {
      read = tsReadsAnchoredMember(cSrc, anchor, key);
    } else if (camelAlias) {
      // Drizzle-mapped: the read happens under the camelCase alias.
      read = tsReadsKeyAsMember(cSrc, camelAlias) || tsReadsKeyAsMember(cSrc, key);
    } else {
      read = tsReadsKeyAsMember(cSrc, key);
    }
    if (!read) {
      const anchorNote = anchor ? ` (anchored to \`${anchor}\`)` : "";
      const aliasNote = camelAlias ? ` (camelCase alias \`${camelAlias}\`)` : "";
      problems.push(
        `  [${key}] NOT read at a real member-access site${anchorNote}${aliasNote} in consumer ` +
          `${consumer.file} — gate-input key renamed on the consumer side; the ${key} promotion ` +
          `gate reads \`undefined\` and silently grandfather-PASSes every strategy.`,
      );
    }
  }

  return problems;
}

export function checkGateContractKeys(
  contract: GateSurface[] = GATE_CONTRACT,
  opts: SurfaceOpts,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const surface of contract) problems.push(...checkSurface(surface, opts));
  return { ok: problems.length === 0, problems };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────────────────────

function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, ".."); // scripts/ → repo root
}

function isMain(): boolean {
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const rootDir = repoRoot();
  const override = process.env.TF_GATE_CONTRACT_OVERRIDE_JSON;
  const contract: GateSurface[] = override ? (JSON.parse(override) as GateSurface[]) : GATE_CONTRACT;
  const { ok, problems } = checkGateContractKeys(contract, { rootDir });

  if (!ok) {
    console.error(
      `[check-gate-contract-keys] BROKEN CONTRACT — ${problems.length} gate key structural site(s) out of sync:\n` +
        problems.join("\n") +
        `\n\nRe-align the producer emit + consumer member-read for each key (or update GATE_CONTRACT ` +
        `in scripts/check-gate-contract-keys.ts if a rename is intentional).`,
    );
    process.exit(1);
  }

  console.log(
    `[check-gate-contract-keys] CLEAN — ${contract.length} gate-contract key(s) verified at real ` +
      `producer-emit + consumer member-read sites (AST-strict; comments/strings do not count).`,
  );
}
