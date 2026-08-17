/**
 * AR-1277 §8 — THE CONTROL-PLANE SEAT'S OWN GUARD.
 *
 * 🛑 WHY THIS IS NEW CODE INSTEAD OF THE PROVEN TOOLBOX GUARD — MEASURED, NOT PREFERRED.
 *
 * The obvious move is to reuse the pinned toolbox guard that governs Worker-1. It cannot be
 * reused, for two independent reasons read out of the pinned source at
 * `advisor-prepared/gpt-speed-engineering-lane/tooling/lane-boundary-guard.mjs` @ b6c70282:
 *
 *   1. `classifyPath(worker, ...)` opens with
 *          if (!['worker-1','worker-2'].includes(worker)) throw new Error(...)
 *      so a `top-level-control-plane-guard-repair` actor cannot even be expressed — it throws.
 *
 *   2. `SELF_PROTECTED_RULES` denies `.claude/settings.json`, `hook-guard-manifest`,
 *      `.claude/hooks/` and the toolbox prefix, and `DENY_REGARDLESS_VERDICTS` makes that
 *      un-overridable by scope. Those files ARE AR-1278's work surface. A control-plane seat
 *      wearing the Worker-1 guard would be denied the entire packet it exists to perform.
 *
 * So the choice is not "new guard vs proven guard" — it is "new guard vs no guard", and AR-1276C
 * §8 is explicit that hands-free does not mean unguarded. This file is therefore the part of the
 * package most in need of GPT's review, and it is written to be read: default DENY, allowlist
 * supplied by GPT authority, categorical denials that no ruling can switch off.
 *
 * ★ INVERSION FROM THE WORKER GUARD. Worker-1's guard is "allow the lane, deny the listed
 * surfaces". This one is "deny everything, allow only what THIS authorization enumerates". A
 * privileged seat with a broad allow and a deny list is one forgotten entry away from being
 * general-purpose. `DEFAULT DENY IS THE ONLY DEFAULT A PRIVILEGED SEAT MAY HAVE.`
 */

import { CATEGORICAL_FORBIDDEN_PATH_TOKENS } from './authorization.mjs';

/**
 * Surfaces the control-plane seat may never touch regardless of the allowlist. These are not
 * "scope"; they are the frozen plane and the money path. AR-1276C §8 requires them categorical.
 */
export const CATEGORICAL_DENY_PREFIXES = Object.freeze([
  'src/engine/backtester',
  'src/engine/exits/',
  'src/server/services/paper-',
  'src/server/services/broker-',
  'src/server/production/',
]);

/** Tools the control-plane seat may not use at all during AR-1278. */
export const DENIED_TOOLS = Object.freeze(['Agent', 'Task', 'PowerShell']);

export function normalizeRepoPath(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

/**
 * Default-deny path classifier for the privileged seat.
 * @param rawPath      repo-relative path the seat wants to write
 * @param allowedPaths the EXACT allowlist from the validated authorization marker
 */
export function classifyControlPlanePath(rawPath, allowedPaths) {
  const path = normalizeRepoPath(rawPath);
  if (path === '') return { path, verdict: 'DENY', reason: 'unreadable path' };

  // Escapes are decided before anything else: a path that leaves the repo is not a scope question.
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
    return { path, verdict: 'DENY', reason: 'path escapes the repository' };
  }

  const lower = path.toLowerCase();
  for (const token of CATEGORICAL_FORBIDDEN_PATH_TOKENS) {
    if (lower.includes(token.toLowerCase())) {
      return { path, verdict: 'DENY_CATEGORICAL', reason: `frozen G2 plane: ${token}` };
    }
  }
  for (const prefix of CATEGORICAL_DENY_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return { path, verdict: 'DENY_CATEGORICAL', reason: `money-path surface: ${prefix}` };
    }
  }

  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) {
    return { path, verdict: 'DENY', reason: 'no authorization allowlist in force' };
  }
  for (const allowed of allowedPaths) {
    const a = normalizeRepoPath(allowed);
    const isPrefix = a.endsWith('/') ? lower.startsWith(a.toLowerCase()) : lower === a.toLowerCase();
    if (isPrefix) {
      return { path, verdict: 'ALLOW', reason: `matches authorized path ${a}` };
    }
  }
  return { path, verdict: 'DENY', reason: 'not in the authorized control-plane allowlist' };
}

export function classifyControlPlaneTool(toolName) {
  if (DENIED_TOOLS.includes(toolName)) {
    return {
      verdict: 'DENY',
      reason:
        `${toolName} is denied for the control-plane seat: AR-1276C §8 forbids Agent/subagent ` +
        'dispatch during AR-1278, and PowerShell is the uncovered surface the packet exists to close',
    };
  }
  return { verdict: 'ALLOW', reason: 'tool is not on the control-plane denial list' };
}

/**
 * Identity check. AR-1276C §8: "fail closed if its branch/base/toolbox/frozen-state/ruling
 * identity differs." Every field is compared, and the FIRST mismatch refuses — a seat that is
 * wrong about who it is must not proceed to be right about anything else.
 */
export function verifySeatIdentity(observed, expected) {
  const fields = ['actor', 'branch', 'worktree', 'targetPacket', 'authorizationId', 'queueSha256'];
  for (const f of fields) {
    if (observed?.[f] !== expected?.[f]) {
      return {
        ok: false,
        code: `identity_mismatch_${f}`,
        detail: `${f}: seat has ${JSON.stringify(observed?.[f])}, authorization requires ${JSON.stringify(expected?.[f])}`,
      };
    }
  }
  if (observed.isSubagent === true) {
    return { ok: false, code: 'not_top_level', detail: 'the control-plane seat must be top-level, never an Agent/subagent' };
  }
  return { ok: true };
}
