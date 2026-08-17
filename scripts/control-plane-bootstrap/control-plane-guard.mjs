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
import { COMMIT_MSG_FILE_REL } from './plan.mjs';

/**
 * AR-1291A F20 — WRITABLE DOES NOT MEAN STAGEABLE.
 *
 * `.cp-commit-msg.tmp` must be in `allowed_paths` so Edit/Write can create it (cp-finalize.mjs
 * requires it to exist) — but `classifyControlPlanePath` is the SAME function both Edit/Write and
 * the `git add <path>` Bash shape go through, so putting it in `allowed_paths` also made
 * `git add scripts/control-plane-bootstrap/.cp-commit-msg.tmp` a legal Bash command. `cp-finalize.mjs`
 * measures staged paths, then deletes the WORKING-TREE copy of the message file — deleting the file
 * does not unstage an already-staged addition, so the transient file could ride into the final
 * commit on a literal reading of "stage the allowed paths," no malicious behaviour required.
 *
 * The fix is categorical and specific to the git-add SHAPE, not to the path classifier every other
 * caller shares — Edit/Write must keep ALLOWing this exact path.
 */
export const NEVER_STAGEABLE_PATHS = Object.freeze([COMMIT_MSG_FILE_REL]);

export const CATEGORICAL_DENY_PREFIXES = Object.freeze([
  'src/engine/backtester',
  'src/engine/exits/',
  'src/server/services/paper-',
  'src/server/services/broker-',
  'src/server/production/',
  'advisor-prepared/gpt-speed-engineering-lane/tooling/',
]);

/**
 * AR-1278A F-12 — A CLOSED TOOL ALLOWLIST, BECAUSE THE MATCHER WAS THE REAL BOUNDARY.
 *
 * The previous version denied unknown tools inside `decide()` and had a unit test proving it — but
 * the MATERIALIZED settings registered PreToolUse only for `Edit|Write|NotebookEdit|Bash|Agent|
 * Task|PowerShell`, so an unlisted tool never reached `decide()` at all. The unit test was green and
 * the installed registration was not default-deny. That is the second registration-level false green
 * in this campaign, and it is the same lesson as the fence scanner:
 *   `A DECISION FUNCTION IS ONLY AS DEFAULT-DENY AS THE EVENTS THAT REACH IT.`
 * The seat now registers ALL_TOOLS_MATCHER and decides here, from a closed allowlist.
 */
export const ALLOWED_TOOLS = Object.freeze(['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash']);

/** Named explicitly so their denial is visible in the code, not merely implied by absence. */
export const DENIED_TOOLS = Object.freeze(['Agent', 'Task', 'PowerShell', 'AskUserQuestion', 'ExitPlanMode']);

/** Documented all-tools matcher: `*` runs the hook for every tool, built-ins and MCP included. */
export const ALL_TOOLS_MATCHER = '*';

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

/** Shared by the write and read classifiers so the two categorical lists cannot drift apart. */
function categoricalDenyReason(lower) {
  for (const token of CATEGORICAL_FORBIDDEN_PATH_TOKENS) {
    if (lower.includes(token.toLowerCase())) return `protected surface: ${token}`;
  }
  for (const prefix of CATEGORICAL_DENY_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) return `money-path/toolbox surface: ${prefix}`;
  }
  return null;
}

export function classifyControlPlanePath(rawPath, allowedPaths) {
  const path = normalizeRepoPath(rawPath);
  if (path === '') return { path, verdict: 'DENY', reason: 'unreadable path' };

  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
    return { path, verdict: 'DENY', reason: 'path escapes the repository' };
  }

  const lower = path.toLowerCase();
  const catReason = categoricalDenyReason(lower);
  if (catReason) return { path, verdict: 'DENY_CATEGORICAL', reason: catReason };

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

/**
 * AR-1298 F29 — THE REAL PATHS BEHIND THE FROZEN-SURFACE TOKENS, FOR ANCESTOR DETECTION ONLY.
 *
 * `CATEGORICAL_FORBIDDEN_PATH_TOKENS` are matched via `.includes()` — they catch a DIRECT hit
 * anywhere in a candidate path, but say nothing about whether a shorter, ordinary-looking root is
 * an ANCESTOR of one of them. That gap is exactly what a recursive Glob/Grep can walk through: a
 * no-path search at the repository root, or a search rooted at `docs/` or `docs/replay-results/`,
 * never directly targets the frozen queue file — it just recurses INTO it. This is the small, fixed,
 * explicit list of the real relative paths those tokens name, used ONLY to answer "would recursing
 * from this root reach a protected surface?" — no filesystem access, ever. `F29-D1` in the test
 * suite asserts every one of these paths actually contains its corresponding token, so the two
 * lists cannot silently drift apart.
 */
export const PROTECTED_SURFACE_PATHS = Object.freeze([
  'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated_fallback_queue_t1.json',
  'docs/replay-results/svkm-extraction-certified/grade/opus-v2/isolated-receipts-t1',
  'docs/replay-results/svkm-extraction-certified/grade/opus-v2/native_call_manifest_t1.json',
  '.claude/settings.local.json',
  '.claude/control-plane-guard-manifest.json',
  'scripts/control-plane-bootstrap/claims',
]);

/**
 * AR-1299 F30 — THE COMPLETE ANCESTOR-PROTECTED UNION, NOT ONLY THE SIX TOKEN-BACKED PATHS.
 *
 * GPT (AR-1298A) found that F29 closed the ancestor bypass ONLY for `PROTECTED_SURFACE_PATHS` —
 * the frozen G2 queue/receipts/native-manifest surfaces — while leaving the SAME bypass class open
 * on `CATEGORICAL_DENY_PREFIXES` (the money/toolbox surfaces: backtester, exits, paper-/broker-
 * services, production, the gpt-speed-engineering-lane toolbox). A direct `Read` of those prefixes
 * already denies via `categoricalDenyReason`, but a recursive `Glob('src/')` or `Grep('src/server/')`
 * is not a direct hit on any prefix string, so it fell through to `ancestorOfProtectedSurface`,
 * which never looked at `CATEGORICAL_DENY_PREFIXES` at all.
 *
 * The fix is a UNION, not a second parallel check: every `CATEGORICAL_DENY_PREFIXES` entry is
 * itself already a valid "surface path prefix" for the same `startsWith(root)` ancestor test the
 * six token-backed paths use (a filename-prefix entry like `src/server/services/paper-` behaves
 * identically to a concrete file path for this purpose — `'…paper-….ts'.startsWith('src/server/services/')`
 * is exactly the property being tested). Folding both lists into one target set means the two-way
 * coverage invariant (every categorical prefix is ancestor-protected, and every token-backed path
 * still traces to an existing token/prefix) holds BY CONSTRUCTION — there is no second list to drift.
 */
export const RECURSIVE_ANCESTOR_TARGETS = Object.freeze([...PROTECTED_SURFACE_PATHS, ...CATEGORICAL_DENY_PREFIXES]);

/**
 * True when a recursive search rooted at `relPath` (already repo-relative; `''` means the
 * repository root) could reach one of `RECURSIVE_ANCESTOR_TARGETS` as a descendant — i.e. `relPath`
 * is empty, or is a `/`-bounded ancestor of one of them. Pure string comparison against the fixed
 * union above; never touches the filesystem, so this stays deterministic and cheap regardless of
 * how large the real tree is.
 */
export function ancestorOfProtectedSurface(relPath) {
  if (relPath === '') return true;
  const root = `${relPath.replace(/\/+$/, '')}/`.toLowerCase();
  return RECURSIVE_ANCESTOR_TARGETS.some((surface) => surface.toLowerCase().startsWith(root));
}

/**
 * AR-1296A F27 — THE READ-ONLY POLICY. Distinct from `classifyControlPlanePath` above on purpose:
 * that function decides the narrow WRITE allowlist a ruling authorizes; this one decides ordinary
 * repository-contained READS, which the packet needs far more broadly to inspect itself, the ruling,
 * and its own source — while still categorically refusing the frozen G2 queue, the isolated receipt
 * namespace, and the native-call manifest, exactly like the write path does. Reading a path this
 * function ALLOWs never grants Edit/Write/NotebookEdit/staging on that same path — those still go
 * through `classifyControlPlanePath` and the ruling's narrow `allowed_paths`.
 *
 * `rawPath` must already be a repo-relative path (run it through `toRepoRelative` first), or the
 * literal `''` sentinel meaning "no path was supplied" (Glob/Grep with no `path` argument).
 *
 * AR-1298 F29 — `''` is no longer an automatic ALLOW. A no-path recursive Glob/Grep is, by
 * definition, an ancestor of every protected surface, so it now falls through to the SAME
 * ancestor check every other root does (`ancestorOfProtectedSurface` returns `true` immediately
 * for `''`) rather than a bespoke early-return that skipped the check entirely.
 */
export function classifyControlPlaneReadPath(rawPath) {
  const path = normalizeRepoPath(rawPath);

  if (path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
    return { path, verdict: 'DENY', reason: 'path escapes the repository' };
  }

  const lower = path.toLowerCase();
  const catReason = categoricalDenyReason(lower);
  if (catReason) return { path, verdict: 'DENY_CATEGORICAL', reason: catReason };

  if (ancestorOfProtectedSurface(path)) {
    return {
      path,
      verdict: 'DENY_CATEGORICAL',
      reason: path === ''
        ? 'recursive search from the repository root can reach every protected surface'
        : 'recursive search root is an ancestor of a protected surface',
    };
  }

  return { path, verdict: 'ALLOW', reason: 'repository-contained read' };
}

/**
 * AR-1296A F27 — THE ONE NORMALIZATION BOUNDARY, RUN BEFORE ANY CLASSIFICATION.
 *
 * `pathFromToolInput` in `control-plane-seat-hook.mjs` previously handed raw tool paths straight to
 * `classifyControlPlanePath`, which refuses EVERY absolute path unconditionally — so a legitimate
 * in-worktree absolute path (which Claude tool payloads commonly carry, and which Windows/MSYS can
 * spell three different ways for the identical file) was indistinguishable from a real escape.
 *
 * `worktreeRoot` MUST be measured from the live environment (`observed.worktree`) — never supplied
 * by model text; a caller that resolves against anything else has rebuilt the exact hole F-1/F-8
 * already closed one layer up. This function has no I/O and performs no filesystem resolution: it is
 * pure string classification of the three known-equivalent spellings against that trusted root.
 *
 * Recognises: a relative path (already repo-relative); `C:\root\file` / `C:/root/file` (Windows,
 * either slash direction); `/c/root/file` (MSYS). All three resolve to the SAME repo-relative
 * result when they name the same in-worktree file. A worktree `C:/repo` does NOT accept the sibling
 * `C:/repo-evil/x` — the boundary is `/`-delimited, never a raw string prefix. The Windows drive
 * letter compares case-insensitively (`c:` and `C:` are the same drive); every path segment past it
 * compares case-sensitively on both Windows and POSIX — this function must never silently make a
 * POSIX path case-insensitive. `..` denies, before and after the boundary strip.
 */
export function toRepoRelative(rawPath, worktreeRoot) {
  if (typeof rawPath !== 'string' || rawPath === '') return { ok: false, reason: 'unreadable path' };
  if (typeof worktreeRoot !== 'string' || worktreeRoot === '') {
    return { ok: false, reason: 'no worktree root to resolve against' };
  }

  const slashify = (s) => s.replaceAll('\\', '/');
  let p = slashify(rawPath);
  const root = slashify(worktreeRoot).replace(/\/+$/, '');

  // MSYS spelling of a Windows drive path: `/c/...` -> `C:/...`. The capture is exactly one letter
  // so this never misfires on a genuine multi-letter POSIX path such as `/etc/passwd`.
  const msys = /^\/([A-Za-z])\/(.*)$/.exec(p);
  if (msys) p = `${msys[1].toUpperCase()}:/${msys[2]}`;

  const isAbsolute = p.startsWith('/') || /^[A-Za-z]:\//.test(p);
  if (!isAbsolute) {
    const rel = p.replace(/^\.\//, '');
    if (rel.split('/').includes('..')) return { ok: false, reason: 'path escapes the repository' };
    return { ok: true, relPath: rel };
  }

  const driveOf = (s) => {
    const m = /^([A-Za-z]):\/(.*)$/.exec(s);
    return m ? { drive: m[1].toUpperCase(), rest: `/${m[2]}` } : null;
  };
  const pDrive = driveOf(p);
  const rootDrive = driveOf(root);

  let pCanon = p;
  let rootCanon = root;
  if (pDrive || rootDrive) {
    if (!pDrive || !rootDrive || pDrive.drive !== rootDrive.drive) {
      return { ok: false, reason: 'path escapes the repository' };
    }
    pCanon = pDrive.rest;
    rootCanon = rootDrive.rest;
  }

  if (pCanon === rootCanon) return { ok: true, relPath: '' };
  const boundary = rootCanon.endsWith('/') ? rootCanon : `${rootCanon}/`;
  if (!pCanon.startsWith(boundary)) return { ok: false, reason: 'path escapes the repository' };
  const rel = pCanon.slice(boundary.length);
  if (rel.split('/').includes('..')) return { ok: false, reason: 'path escapes the repository' };
  return { ok: true, relPath: rel };
}

export function classifyControlPlaneTool(toolName) {
  if (typeof toolName !== 'string' || toolName === '') {
    return { verdict: 'DENY', reason: 'unreadable tool name' };
  }
  if (DENIED_TOOLS.includes(toolName)) {
    return {
      verdict: 'DENY',
      reason:
        `${toolName} is explicitly denied for the control-plane seat: Agent/Task dispatch is forbidden, ` +
        'PowerShell is the uncovered surface the packet exists to close, and a scripted privileged ' +
        'seat must never stop to ask the operator a question',
    };
  }
  if (toolName.startsWith('mcp__')) {
    return { verdict: 'DENY', reason: `MCP tool ${toolName} is not authorized for the control-plane seat` };
  }
  if (!ALLOWED_TOOLS.includes(toolName)) {
    // The default-deny line. Every future/unknown tool lands here.
    return { verdict: 'DENY', reason: `tool ${toolName} is not in the closed control-plane allowlist — default deny` };
  }
  return { verdict: 'ALLOW', reason: `${toolName} is in the closed control-plane allowlist` };
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
  // AR-1296A F28 — the ONE fixed, read-only authority-read command. A literal, exactly like
  // `g2-prompt-transport` and `cp-finalize` below: no condition, no path, no argument, no ref the
  // model can choose. Any other `git show` invocation — a different ref, an extra path, a redirect,
  // a pipe — falls through to the default deny at the bottom of this table, same as every other
  // shape here.
  { id: 'authority-read', re: /^git show --format= --no-ext-diff origin\/external-advisor\/gpt-rulings -- advisor-reports\/$/ },
  // AR-1278A F-15: EXACT test commands, never a wildcard. The previous shape allowed
  // `node --test scripts/<anything>.test.mjs`, and a test file is executable code — `readOnly:true`
  // described the Bash shape, not what the JavaScript inside it could do. A privileged seat does not
  // get to run arbitrary repository programs because their filename ends in `.test.mjs`.
  { id: 'test-bootstrap-suite', re: /^node --test scripts\/control_plane_bootstrap\.test\.mjs$/ },
  { id: 'test-lifecycle-suite', re: /^node --test scripts\/control-plane-bootstrap\/lifecycle\.test\.mjs$/ },
  { id: 'git-add', re: /^git add ([A-Za-z0-9._\/-]+)$/, pathArg: 1 },
  // AR-1291 §A/B — the ONE fixed transport command. No condition, no path, no argument at all:
  // the regex is a literal, so `... .py foo`, `python -c ...` and any other variant fall through
  // to the default deny below, exactly like every other exact-shape entry in this table.
  { id: 'g2-prompt-transport', re: /^python scripts\/control-plane-bootstrap\/materialize-g2-prompt-transport\.py$/ },
  // AR-1292A F22 — cp-commit.mjs's Bash shape is RETIRED, not the file. It commits locally but
  // never pushes and never writes the trusted completion receipt, so a legally-invoked cp-commit
  // could advance HEAD, delete the message file, and strand the one-shot authorization in a
  // local-only state the terminal finalizer exists to prevent — exactly the class of thing F21 just
  // closed on the OTHER side of this same seam. The file stays in the repo (and in BUNDLE_FILES) as
  // historical/conservative bundled code; only its privileged Bash route is gone. Do not re-add an
  // entry for it here without a fresh ruling.
  // AR-1278A F-14: the ONE terminal finalize path. It takes no arguments at all, so there is
  // nothing for model text to choose.
  { id: 'cp-finalize', re: /^node scripts\/control-plane-bootstrap\/cp-finalize\.mjs$/ },
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
      // AR-1291A F20: this bites ONLY the git-add shape and ONLY the one transient path — an
      // ordinary authorized path staged through the same shape falls through unaffected.
      if (shape.id === 'git-add') {
        const normalizedTarget = normalizeRepoPath(target).toLowerCase();
        const isNeverStageable = NEVER_STAGEABLE_PATHS.some((p) => normalizeRepoPath(p).toLowerCase() === normalizedTarget);
        if (isNeverStageable) {
          return { verdict: 'DENY', reason: `${target} is the transient commit-message file and may never be staged` };
        }
      }
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
