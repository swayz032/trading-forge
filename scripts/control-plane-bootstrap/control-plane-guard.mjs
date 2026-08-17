/**
 * AR-1277/1278 §8 — THE CONTROL-PLANE SEAT'S OWN GUARD.
 *
 * 🛑 WHY THIS IS NEW CODE INSTEAD OF THE PROVEN TOOLBOX GUARD — MEASURED, NOT PREFERRED.
 * At pin b6c70282, `lane-boundary-guard.mjs:175` throws unless the worker is `worker-1`/`worker-2`,
 * so the control-plane actor cannot be expressed; and its `SELF_PROTECTED_RULES` deny
 * `.claude/settings.json`, `hook-guard-manifest`, `.claude/hooks/` and the toolbox prefix
 * un-overridably — which is exactly AR-1279's work surface. A control-plane seat wearing the
 * Worker-1 guard would be denied its entire packet. The choice was never "new guard vs proven
 * guard"; it was "new guard vs no guard".
 *
 * ★ DEFAULT DENY, INVERTED FROM THE WORKER GUARD. Worker-1's guard allows its lane and denies a
 * listed set. This one denies everything and allows only what THIS authorization enumerates.
 *
 * ★ AR-1278 F-2 — BASH WAS THE HOLE, AND IT WAS MINE.
 * The first version returned ALLOW for Bash and then only scanned the command for three frozen-G2
 * token strings; anything else ran. So Bash could write a path `Edit`/`Write` would have denied,
 * and the packet still described itself as default-deny. GPT caught it.
 * `A DENY LIST ON ONE TOOL IS NOT A BOUNDARY WHEN ANOTHER TOOL WRITES THE SAME FILES.`
 * Bash is now default-DENY with a small closed set of exact command shapes, and every mutating
 * shape re-enters the same path classifier the Edit/Write arm uses.
 */

import { CATEGORICAL_FORBIDDEN_PATH_TOKENS } from './authorization.mjs';

export const CATEGORICAL_DENY_PREFIXES = Object.freeze([
  'src/engine/backtester',
  'src/engine/exits/',
  'src/server/services/paper-',
  'src/server/services/broker-',
  'src/server/production/',
  'advisor-prepared/gpt-speed-engineering-lane/tooling/',
]);

/** Tools the control-plane seat may not use at all during its packet. */
export const DENIED_TOOLS = Object.freeze(['Agent', 'Task', 'PowerShell']);

/**
 * Shell metacharacters that turn one command into several, or redirect its output. Any of these
 * refuses before the command is matched against the allowlist — the allowlist describes single,
 * literal commands, and composition is how a literal allowlist stops meaning anything.
 */
const SHELL_COMPOSITION = /[;&|<>`\n\r]|\$\(|\$\{/;

export function normalizeRepoPath(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

export function classifyControlPlanePath(rawPath, allowedPaths) {
  const path = normalizeRepoPath(rawPath);
  if (path === '') return { path, verdict: 'DENY', reason: 'unreadable path' };

  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
    return { path, verdict: 'DENY', reason: 'path escapes the repository' };
  }

  const lower = path.toLowerCase();
  for (const token of CATEGORICAL_FORBIDDEN_PATH_TOKENS) {
    if (lower.includes(token.toLowerCase())) {
      return { path, verdict: 'DENY_CATEGORICAL', reason: `protected surface: ${token}` };
    }
  }
  for (const prefix of CATEGORICAL_DENY_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return { path, verdict: 'DENY_CATEGORICAL', reason: `money-path/toolbox surface: ${prefix}` };
    }
  }

  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    return { path, verdict: 'DENY', reason: 'no authorization allowlist in force' };
  }
  for (const allowed of allowedPaths) {
    const a = normalizeRepoPath(allowed);
    const isPrefix = a.endsWith('/') ? lower.startsWith(a.toLowerCase()) : lower === a.toLowerCase();
    if (isPrefix) return { path, verdict: 'ALLOW', reason: `matches authorized path ${a}` };
  }
  return { path, verdict: 'DENY', reason: 'not in the authorized control-plane allowlist' };
}

export function classifyControlPlaneTool(toolName) {
  if (DENIED_TOOLS.includes(toolName)) {
    return {
      verdict: 'DENY',
      reason:
        `${toolName} is denied for the control-plane seat: Agent/subagent dispatch is forbidden for ` +
        'this packet, and PowerShell is the uncovered surface the packet exists to close',
    };
  }
  return { verdict: 'ALLOW', reason: 'tool is not on the control-plane denial list' };
}

/* ------------------------------------------------------------------ Bash policy -------------- */

/**
 * The closed set of Bash shapes the privileged seat may run. Read-only inspection, the focused
 * test runner, and the narrow staging/commit/push helpers — nothing else. `pathArg` marks a shape
 * whose captured group is a repository path that must additionally clear the path classifier, so a
 * staging command can never stage something an Edit would have been denied.
 */
export const BASH_ALLOWED_SHAPES = Object.freeze([
  { id: 'git-status', re: /^git status --porcelain$/ },
  { id: 'git-head', re: /^git rev-parse HEAD$/ },
  { id: 'git-branch', re: /^git rev-parse --abbrev-ref HEAD$/ },
  { id: 'git-log', re: /^git log --oneline -\d{1,2}$/ },
  { id: 'git-diff-stat', re: /^git diff --stat$/ },
  { id: 'git-diff-cached-stat', re: /^git diff --cached --stat$/ },
  { id: 'node-focused-test', re: /^node --test (scripts\/[A-Za-z0-9._\/-]+\.test\.mjs)$/, pathArg: 1, readOnly: true },
  { id: 'git-add', re: /^git add ([A-Za-z0-9._\/-]+)$/, pathArg: 1 },
  { id: 'cp-commit', re: /^node scripts\/control-plane-bootstrap\/cp-commit\.mjs --msg-file scripts\/control-plane-bootstrap\/\.cp-commit-msg\.tmp$/ },
  { id: 'git-push', re: /^git push origin (control-plane\/[a-z0-9.-]+)$/, branchArg: 1 },
]);

/**
 * @param command the raw Bash command
 * @param ctx     { allowedPaths, branch }
 */
export function classifyControlPlaneBash(command, ctx = {}) {
  if (typeof command !== 'string' || command.trim() === '') {
    return { verdict: 'DENY', reason: 'unreadable Bash command' };
  }
  const cmd = command.trim();

  if (SHELL_COMPOSITION.test(cmd)) {
    return { verdict: 'DENY', reason: 'shell composition (pipe/redirect/substitution/chaining) is not permitted' };
  }
  // Arbitrary code passthrough, even under an allowed executable name.
  if (/\bnode\s+-e\b/.test(cmd) || /\bpython\d?\s+-c\b/.test(cmd) || /\bnpx\b/.test(cmd) || /\bsh\s+-c\b/.test(cmd) || /\bbash\s+-c\b/.test(cmd)) {
    return { verdict: 'DENY', reason: 'arbitrary code passthrough is not permitted' };
  }

  for (const shape of BASH_ALLOWED_SHAPES) {
    const m = shape.re.exec(cmd);
    if (!m) continue;

    if (shape.pathArg) {
      const target = m[shape.pathArg];
      const v = classifyControlPlanePath(target, ctx.allowedPaths);
      // A read-only shape still may not READ into a categorically protected surface.
      if (shape.readOnly && v.verdict === 'ALLOW') return { verdict: 'ALLOW', reason: `${shape.id} on ${target}` };
      if (shape.readOnly && v.verdict !== 'DENY_CATEGORICAL') return { verdict: 'ALLOW', reason: `${shape.id} (read-only) on ${target}` };
      if (v.verdict !== 'ALLOW') {
        return { verdict: 'DENY', reason: `${shape.id} targets ${v.path}: ${v.reason}` };
      }
      return { verdict: 'ALLOW', reason: `${shape.id} on authorized ${target}` };
    }

    if (shape.branchArg) {
      const branch = m[shape.branchArg];
      if (branch !== ctx.branch) {
        return { verdict: 'DENY', reason: `push targets ${branch}, seat branch is ${ctx.branch}` };
      }
      return { verdict: 'ALLOW', reason: `${shape.id} to ${branch}` };
    }

    return { verdict: 'ALLOW', reason: shape.id };
  }

  // No fallthrough. This is the line AR-1277A F-2 required.
  return { verdict: 'DENY', reason: 'Bash command is not in the control-plane allowlist — default deny' };
}

/* ------------------------------------------------------------------ identity ----------------- */

/**
 * AR-1278 F-6 — the full identity contract. AR-1276C §8 required the seat to fail closed on
 * branch/base/toolbox/frozen/ruling differences; the first version compared six fields and omitted
 * repo, head, ruling and bundle entirely.
 *
 * 🛑 The caller MUST pass an `observed` it MEASURED from the live environment. Building `observed`
 * out of the manifest makes this function compare the manifest to itself, which is AR-1277A F-1 and
 * was a real hole in the first implementation.
 */
export const IDENTITY_FIELDS = Object.freeze([
  'repo', 'worktree', 'branch', 'head', 'actor', 'targetPacket',
  'authorizationId', 'rulingId', 'queueSha256', 'bundleSha256',
]);

export function verifySeatIdentity(observed, expected) {
  if (!observed || typeof observed !== 'object') {
    return { ok: false, code: 'no_observed_identity', detail: 'nothing was measured' };
  }
  for (const f of IDENTITY_FIELDS) {
    if (expected?.[f] === undefined || expected?.[f] === null) {
      return { ok: false, code: `expected_missing_${f}`, detail: `authorization does not pin ${f}` };
    }
    if (observed?.[f] !== expected?.[f]) {
      return {
        ok: false,
        code: `identity_mismatch_${f}`,
        detail: `${f}: measured ${JSON.stringify(observed?.[f])}, authorization requires ${JSON.stringify(expected?.[f])}`,
      };
    }
  }
  if (observed.isSubagent === true) {
    return { ok: false, code: 'not_top_level', detail: 'the control-plane seat must be top-level, never an Agent/subagent' };
  }
  if (observed.ready !== 8 || observed.spent !== 0 || observed.receiptsReadmeOnly !== true) {
    return {
      ok: false,
      code: 'frozen_state_drift',
      detail: `frozen plane is not pristine: ready=${observed.ready} spent=${observed.spent} receiptsReadmeOnly=${observed.receiptsReadmeOnly}`,
    };
  }
  return { ok: true };
}
