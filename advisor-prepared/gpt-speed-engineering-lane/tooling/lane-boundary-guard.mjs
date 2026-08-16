#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// AR-1263 §7A. The guard's own control surface. These deny REGARDLESS of packet scope,
// because a packet that lists a broad prefix such as `.claude/` would otherwise hand the
// worker authority over the rules that bind it.
//
// BOOTSTRAP NOTE, deliberate: with the guard ACTIVE a worker cannot repair this toolbox.
// That is the point — a repair is a desk-authorized packet on the toolbox authority branch
// (as AR-1264 itself is), not something a guarded seat grants itself mid-session.
// AR-1267 §3 (F-1) — THE LIVE DOORWAY WAS REACHABLE BY THE WORKER IT GUARDS.
// AR-1264 protected the manifest, the settings, `.claude/hooks/` and the pinned toolbox. Then
// AR-1266 moved the EXECUTING control path into two Worker-1 files under `scripts/` — and
// `scripts/` is an ALLOWED prefix in the Worker-1 edit scope. So the guarded worker could edit
// the doorway that runs the guard and the activator that decides WHICH guard gets run, which is
// a self-authorization surface however narrow the packet is.
//   `A GUARD YOU ARE PERMITTED TO EDIT IS A GUARD YOU AUTHORED.`
// These are `exact`, not a `scripts/` prefix, deliberately: the lane's ordinary script work must
// stay allowed, and a prefix here would quietly convert F-1 into a lane-wide freeze.
// `bash_tokens` (AR-1270 §B) are ADDITIONAL distinctive spellings of the SAME surface that the
// Bash fence looks for, for the case where a shell command names the file without its full
// repository path (`cd <dir> && ... isolated_fallback_queue_t1.json`). They are declared HERE,
// beside the rule they belong to, so the fence has no rule list of its own to drift from.
// They are opt-in per rule ON PURPOSE: the bare basenames of `.claude/settings.json` and
// `.claude/hooks/` are `settings.json` and `hooks`, which are far too generic to fence a shell
// command on without bricking ordinary work.
export const SELF_PROTECTED_RULES = [
  { kind: 'contains', value: 'hook-guard-manifest', reason: 'the worker guard manifest declares the worker\'s own permissions' },
  { kind: 'exact', value: '.claude/settings.json', reason: 'live hook registration' },
  { kind: 'exact', value: '.claude/settings.local.json', reason: 'live hook registration' },
  { kind: 'prefix', value: '.claude/hooks/', reason: 'live hook implementations' },
  { kind: 'prefix', value: 'advisor-prepared/gpt-speed-engineering-lane/tooling/', reason: 'the pinned guard toolbox' },
  { kind: 'exact', value: 'scripts/claude_guard_hook.mjs', reason: 'the live hook doorway that executes the guard', bash_tokens: ['claude_guard_hook'] },
  { kind: 'exact', value: 'scripts/claude_toolbox.mjs', reason: 'the activator that selects and materializes the pinned toolbox', bash_tokens: ['claude_toolbox'] },
  { kind: 'exact', value: 'scripts/g2d_precall_transition.py', reason: 'the protected claim->dispatch transition doorway', bash_tokens: ['g2d_precall_transition'] },
  { kind: 'exact', value: 'scripts/g2d_freeze_native_calls.py', reason: 'the freezer of the native-call execution identity', bash_tokens: ['g2d_freeze_native_calls'] },
  // AR-1267 §6 requires a changed prompt/model/condition to DENY before the model runs. That
  // property is only as strong as the artifact it compares against, and the artifact lives under
  // `docs/replay-results/`, which the Worker-1 edit scope ALLOWS. An editable expectation is not
  // an expectation.
  { kind: 'contains', value: 'native_call_manifest', reason: 'the frozen native-call execution identity the pre-call guard matches against' },

  // AR-1270 §A, on AR-1269 §4 (F-5) — THE G2 CONTROL PLANE ITSELF.
  //
  // AR-1268 protected the native-call manifest and left these two, because AR-1267 §9 forbade
  // broadening. AR-1269 §4 confirmed the gap independently and authorized exactly this repair.
  // Both live under `docs/replay-results/`, which the Worker-1 edit scope ALLOWS, so until now
  // the guarded worker could Write its own control plane.
  //
  // THE RECEIPT HALF IS THE SERIOUS ONE. `outstandingCapture()` treats a prior dispatch as
  // captured when `.raw.json` and `.completion.json` merely EXIST, so a worker able to Write into
  // the receipt directory can manufacture file-existence state that clears the forced-capture
  // stop and lets the NEXT one-shot call proceed while the previous answer is still uncaptured.
  // That is control-plane integrity, not denial of service.
  //
  // THE QUEUE HALF IS BOUNDED AND MUST NOT BE OVERSTATED (AR-1269 §4, verbatim: "Do not overstate
  // the queue gap as an authorization bypass"): the native-call manifest pins the queue sha256 and
  // the guard compares it, so a queue edit already FAILS CLOSED rather than authorizing a changed
  // task. It is protected here because an editable frozen artifact is not frozen, not because it
  // was an open authorization hole.
  //
  // 🛑 THIS DOES NOT DISABLE THE DURABLE RECEIPT LAW. These rules bind the CLAUDE TOOL SURFACE —
  // Edit/Write/NotebookEdit and (via the fence below) Bash. The trusted transition doorway writes
  // receipts from inside its own process, which is not a Claude tool call and is not classified
  // here. AR-1269 §6A: "The trusted transition/finalization code may still create receipts through
  // its intended internal process path."
  {
    kind: 'exact',
    value: 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json',
    reason: 'the frozen eight-condition G2 queue',
    bash_tokens: ['isolated_fallback_queue_t1'],
  },
  {
    kind: 'prefix',
    value: 'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1/',
    reason: 'the real G2 one-shot receipt namespace that the forced-capture gate reads as evidence',
    bash_tokens: ['isolated-receipts-t1'],
  },

  // THE ARMED-SESSION MARKER. New control-plane artifact, so it arrives protected.
  //
  // SessionStart now records what it verified in a marker inside the worktree's git directory,
  // and PreToolUse refuses every tool call whose live tree disagrees with it. That makes the
  // marker a thing worth forging: a worker able to write one could manufacture the single fact
  // PreToolUse cannot re-measure — that the tree was CLEAN when the seat started.
  //
  // Scope alone would already refuse it today, because no Worker-1 prefix covers the git
  // directory. That is a property of THIS packet's scope, not of the boundary, and "a broader
  // prefix in some future manifest opens it" is exactly how AR-1269 §4 found the receipt gap.
  // `AN EDITABLE PROOF IS NOT A PROOF.`
  {
    kind: 'contains',
    value: 'tf-claude-guard-session',
    reason: 'the armed-session marker that proves SessionStart verified this exact seat',
    bash_tokens: ['tf-claude-guard-session'],
  },
];

const COORDINATION_RULES = [
  { kind: 'exact', value: 'package.json', reason: 'shared package contract' },
  { kind: 'exact', value: 'src/server/db/schema.ts', reason: 'shared database schema' },
  { kind: 'exact', value: 'src/server/index.ts', reason: 'shared server composition root' },
  { kind: 'prefix', value: '.github/workflows/', reason: 'shared CI workflow' },
  { kind: 'prefix', value: 'src/server/db/migrations/', reason: 'shared database migration' },
];

const WORKER_1_RULES = [
  { kind: 'exact', value: 'src/server/lib/decision-atom.ts' },
  { kind: 'exact', value: 'scripts/atomize-transcript.ts' },
  { kind: 'contains', value: '/compiler/' },
  { kind: 'prefix', value: 'compiler/' },
  { kind: 'contains', value: 'strategy-factory' },
  { kind: 'contains', value: 'decision-atom' },
  { kind: 'contains', value: 'atomize-transcript' },
];

const WORKER_2_RULES = [
  { kind: 'prefix', value: 'src/server/services/paper-' },
  { kind: 'exact', value: 'src/server/routes/paper.ts' },
  { kind: 'contains', value: 'fill-reconciliation-service' },
  { kind: 'contains', value: 'server-mediated-executor' },
  { kind: 'contains', value: '/watchdog/' },
  { kind: 'contains', value: '/recovery/' },
  { kind: 'exact', value: 'src/server/middleware/auth.ts' },
  { kind: 'contains', value: 'auth.middleware' },
  { kind: 'contains', value: 'auth-middleware' },
];

function normalizeRepoPath(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error('changed path must be a non-empty string');
  }
  const normalized = input.trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`unsafe repository path: ${input}`);
  }
  return normalized;
}

function matchesRule(repoPath, rule) {
  if (rule.kind === 'exact') return repoPath === rule.value;
  if (rule.kind === 'prefix') return repoPath.startsWith(rule.value);
  if (rule.kind === 'contains') return repoPath.includes(rule.value);
  throw new Error(`unknown rule kind: ${rule.kind}`);
}

function matchAny(repoPath, rules) {
  return rules.find((rule) => matchesRule(repoPath, rule));
}

function relatedTestOwnership(repoPath) {
  const lower = repoPath.toLowerCase();
  if (!lower.includes('test') && !lower.includes('spec')) return null;
  if (
    lower.includes('compiler') ||
    lower.includes('strategy-factory') ||
    lower.includes('decision-atom') ||
    lower.includes('atomize-transcript')
  ) return 'worker-1';
  if (
    lower.includes('paper') ||
    lower.includes('reconciliation') ||
    lower.includes('executor') ||
    lower.includes('watchdog') ||
    lower.includes('recovery') ||
    lower.includes('auth')
  ) return 'worker-2';
  return null;
}

export function classifyPath(worker, rawPath, options = {}) {
  if (!['worker-1', 'worker-2'].includes(worker)) {
    throw new Error(`worker must be worker-1 or worker-2, got: ${worker}`);
  }
  const repoPath = normalizeRepoPath(rawPath);

  // AR-1263 §7A: self-protection is evaluated FIRST and is not scope-gated.
  // `selfProtectedRules` is injectable so the mutation control can prove this category is
  // what does the work. It is a parameter, never mutable module state — a guard with a
  // runtime switch that disables it is not a guard.
  const selfProtectedRules = options.selfProtectedRules || SELF_PROTECTED_RULES;
  const selfProtected = matchAny(repoPath, selfProtectedRules);
  if (selfProtected) {
    return {
      path: repoPath,
      verdict: 'SELF_PROTECTED',
      reason: `self-protected control surface: ${selfProtected.reason}`,
    };
  }

  const coordination = matchAny(repoPath, COORDINATION_RULES);
  if (coordination) {
    return {
      path: repoPath,
      verdict: 'HANDOFF_REQUIRED',
      reason: coordination.reason,
    };
  }

  const worker1 = matchAny(repoPath, WORKER_1_RULES) || relatedTestOwnership(repoPath) === 'worker-1';
  const worker2 = matchAny(repoPath, WORKER_2_RULES) || relatedTestOwnership(repoPath) === 'worker-2';

  if (worker === 'worker-1' && worker2) {
    return { path: repoPath, verdict: 'BLOCK', reason: 'obvious Worker 2 runtime/safety ownership' };
  }
  if (worker === 'worker-2' && worker1) {
    return { path: repoPath, verdict: 'BLOCK', reason: 'obvious Worker 1 compiler/factory ownership' };
  }
  if (worker === 'worker-1' && worker1) {
    return { path: repoPath, verdict: 'ALLOW_LANE_MATCH', reason: 'matches Worker 1 compiler/factory path evidence' };
  }
  if (worker === 'worker-2' && worker2) {
    return { path: repoPath, verdict: 'ALLOW_LANE_MATCH', reason: 'matches Worker 2 runtime/safety path evidence' };
  }

  return {
    path: repoPath,
    verdict: 'REVIEW_REQUIRED',
    reason: 'path ownership is not provable from the bounded path rules; semantic authority must be checked',
  };
}

// AR-1263 §7A: these deny no matter what the packet scope says.
const DENY_REGARDLESS_VERDICTS = ['SELF_PROTECTED', 'BLOCK', 'HANDOFF_REQUIRED'];

export function auditPaths(worker, paths, options = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('at least one changed path is required');
  }
  const results = paths.map((p) => classifyPath(worker, p, options));
  const blocking = results.filter((x) => [...DENY_REGARDLESS_VERDICTS, 'REVIEW_REQUIRED'].includes(x.verdict));
  const hardDenied = results.filter((x) => DENY_REGARDLESS_VERDICTS.includes(x.verdict));
  const reviewed = results.filter((x) => x.verdict === 'REVIEW_REQUIRED');
  return {
    schema: 'gpt-lane-boundary-audit-v1',
    worker,
    // UNCHANGED MEANING on purpose: review genuinely IS still required, and
    // claude-finish-check / claude-preflight read this field with that strict sense.
    safe_to_edit_without_handoff: blocking.length === 0,
    // AR-1263 §7A precedence fields.
    deny_regardless_of_scope: hardDenied.length > 0,
    scope_gated: hardDenied.length === 0 && reviewed.length > 0,
    deny_reasons: hardDenied.map((x) => `${x.verdict}:${x.path}:${x.reason}`),
    results,
    summary: {
      allow: results.filter((x) => x.verdict === 'ALLOW_LANE_MATCH').length,
      self_protected: results.filter((x) => x.verdict === 'SELF_PROTECTED').length,
      block: results.filter((x) => x.verdict === 'BLOCK').length,
      handoff_required: results.filter((x) => x.verdict === 'HANDOFF_REQUIRED').length,
      review_required: reviewed.length,
    },
  };
}

/**
 * AR-1270 §B, on AR-1269 §5 (F-6) — THE PROTECTED-SURFACE BASH FENCE.
 *
 * 🛑 THE DEFECT THIS CLOSES. PreToolUse is registered for `Edit|Write|NotebookEdit|Bash|Agent|
 * Task`, but only the first three ever had their target path extracted and classified. The Bash
 * arm went to `bashMutationReason()`, a blacklist of mutation SPELLINGS (`sed -i`, `tee`, `rm`,
 * redirection, `writeFileSync`...). A writer whose spelling was not on that list never reached
 * the path classifier AT ALL — so it could target a `SELF_PROTECTED` file freely. Worse, the
 * trusted `scripts/g2d_precall_transition.py` creates REAL receipts, so an unrecognised Bash
 * shape invoking it directly manufactures durable transition state with no native dispatch
 * behind it.
 *
 * ★★★★★ `A COMMAND-SPELLING BLACKLIST CANNOT SUPPORT A CATEGORICAL PATH CLAIM.`
 *
 * 🛑 AND THE FIX IS NOT MORE SPELLINGS. AR-1269 §5, verbatim: "Do not repair this by adding two
 * more spellings such as `dd` or `os.write` to the blacklist. That is whack-a-mole, not a
 * boundary." So this fence does not ask WHAT the command does. It asks WHETHER THE COMMAND
 * REFERENCES A PROTECTED SURFACE AT ALL, and denies if it does — which is decidable without a
 * shell parser and does not care whether the writer is one this desk has seen before.
 *
 * SCOPE, STATED HONESTLY: this is reference-based, so it also denies a harmless `cat` of a
 * protected file, and it denies Bash that names the pinned toolbox directory (which includes
 * running the toolbox's own test files by path). That is stricter than the three shapes AR-1269
 * §6B lists as the minimum. It is deliberate — a uniform rule over the WHOLE self-protected set
 * has no "which subset did you pick, and why" seam for the next writer to walk through — but it
 * is a widening of the stated floor and is disclosed as such. Narrowing it is one field.
 *
 * It is NOT a shell parser and does not try to be. It reads the same `SELF_PROTECTED_RULES` the
 * path classifier reads, because a second copy of a boundary rule drifts and stops biting while
 * still reporting PASS.
 */
function normalizeForFence(text) {
  return text.replaceAll('\\', '/').replace(/\/{2,}/g, '/').toLowerCase();
}

/** Every distinctive spelling of a protected surface, derived FROM the rules, never beside them. */
export function protectedSurfaceTokens(rules = SELF_PROTECTED_RULES) {
  const tokens = [];
  for (const rule of rules) {
    const forms = new Set([rule.value]);
    // `.claude/hooks/` must also fence `ls .claude/hooks` — a trailing slash is a spelling, not a
    // different surface.
    if (rule.value.endsWith('/')) forms.add(rule.value.slice(0, -1));
    for (const extra of rule.bash_tokens || []) forms.add(extra);
    for (const form of forms) {
      if (form) tokens.push({ token: normalizeForFence(form), reason: rule.reason, rule: rule.value });
    }
  }
  return tokens;
}

export function bashProtectedSurfaceReason(command, options = {}) {
  // A Bash event whose command cannot be read is not something a fence can CLEAR. The existing
  // mutation check already treats this as a denial; keeping the same disposition here means the
  // fence never turns an unreadable command into a pass.
  if (typeof command !== 'string' || command.trim() === '') return null;

  const haystack = normalizeForFence(command);
  for (const { token, reason, rule } of protectedSurfaceTokens(options.selfProtectedRules || SELF_PROTECTED_RULES)) {
    if (haystack.includes(token)) {
      return (
        `Bash is not a side door to the protected control plane: this command references ` +
        `\`${rule}\` (${reason}). Denied by the protected-surface fence REGARDLESS of what the ` +
        `command would do — the boundary is the surface, not the spelling of the writer.`
      );
    }
  }
  return null;
}

/**
 * AR-1263 §7A, the whole precedence law in one place:
 *
 *   self-protected / BLOCK / HANDOFF_REQUIRED -> DENY, scope is never consulted
 *   REVIEW_REQUIRED                           -> allow ONLY if packet scope covers it
 *   ALLOW_LANE_MATCH                          -> still must satisfy packet scope
 *
 * Kept as one exported pure function so the bridge, the preflight and the controls all
 * read the SAME rule. A second copy of a boundary rule drifts and stops biting while
 * still reporting PASS.
 */
export function decideEditPermission(laneAudit, scopeResult) {
  if (!laneAudit || typeof laneAudit !== 'object') throw new Error('laneAudit is required');
  if (!scopeResult || typeof scopeResult !== 'object') throw new Error('scopeResult is required');

  if (laneAudit.deny_regardless_of_scope) {
    return { allow: false, reason: `lane guard refused (not scope-overridable): ${laneAudit.deny_reasons.join(' | ')}` };
  }
  if (!scopeResult.ok) {
    return { allow: false, reason: `authorized edit scope rejected: ${scopeResult.out_of_scope.join(', ')}` };
  }
  return { allow: true, reason: 'lane precedence satisfied and target is inside authorized packet scope' };
}

function parseCli(argv) {
  let worker = null;
  let pathsFile = null;
  const paths = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--worker') worker = argv[++i];
    else if (arg === '--paths-file') pathsFile = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`);
    else paths.push(arg);
  }
  if (!worker) throw new Error('--worker is required');
  if (pathsFile) {
    const parsed = JSON.parse(fs.readFileSync(pathsFile, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('--paths-file must contain a JSON array of repository paths');
    paths.push(...parsed);
  }
  return { worker, paths };
}

function main() {
  try {
    const { worker, paths } = parseCli(process.argv.slice(2));
    const audit = auditPaths(worker, paths);
    process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
    if (!audit.safe_to_edit_without_handoff) process.exitCode = 2;
  } catch (error) {
    process.stderr.write(`lane-boundary-guard: ${error.message}\n`);
    process.exitCode = 2;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
