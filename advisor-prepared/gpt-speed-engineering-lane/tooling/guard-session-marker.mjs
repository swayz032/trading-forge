/**
 * THE ARMED-SESSION MARKER — AR-1271A follow-on (the SessionStart -> PreToolUse wire).
 *
 * WHAT WAS WRONG
 *   SessionStart proved the anchor and then announced the result by appending
 *   `export TF_CLAUDE_GUARD_ANCHOR_OK=1` to the file named by `CLAUDE_ENV_FILE`. PreToolUse and
 *   TaskCompleted then read `process.env.TF_CLAUDE_GUARD_ANCHOR_OK` and denied when it was
 *   missing. Nothing ever carried the value from the file to the environment.
 *
 *   MEASURED 2026-08-16 in the shipped claude.exe, two independent facts:
 *     1. `CLAUDE_ENV_FILE` is added to the hook child's environment for SessionStart, Setup,
 *        CwdChanged and FileChanged ONLY. A PreToolUse hook never even learns the path.
 *     2. Its documented contract is "write bash exports there to apply env to subsequent
 *        BashTool commands" — the file feeds the Bash TOOL's shell, not later hook processes.
 *   So the marker could not arrive by any route and the guard denied every tool call in a
 *   correctly-launched seat. Fail-CLOSED, and therefore invisible in every receipt: a seat that
 *   is refused looks exactly like a seat that is behaving.
 *
 * WHY THE OBVIOUS REPAIR IS THE DANGEROUS ONE
 *   Making that bare constant propagate would have converted a harmless fail-CLOSED bug into a
 *   fail-OPEN one. `TF_CLAUDE_GUARD_ANCHOR_OK=1` says nothing about WHICH session, WHICH
 *   worktree, WHICH branch, WHICH commit or WHICH toolbox pin was verified — its entire safety
 *   came from the fact that it never travelled. A marker that travels and is not bound is
 *   inherited: a later session, on the wrong branch, over a rewound HEAD, under a re-pinned
 *   toolbox, would arm itself on somebody else's proof with every receipt green.
 *
 *   `AN UNBOUND MARKER IS SAFE ONLY FOR AS LONG AS IT IS BROKEN.`
 *
 * WHAT THIS DOES INSTEAD
 *   SessionStart mints a marker that NAMES the exact thing it verified, and PreToolUse re-derives
 *   every one of those facts from the live tree and refuses on any disagreement. The marker is
 *   evidence of the one thing PreToolUse genuinely cannot re-measure — that the tree was CLEAN
 *   when the seat started. Everything else is re-measured, not remembered.
 *
 * WHY CLEANLINESS IS NOT RE-CHECKED
 *   A working seat dirties its own tree; that is what it is for. Re-running the require_clean
 *   check on every tool call would deny the seat's second edit, which is the shape of a guard
 *   that gets switched off by whoever it annoys. Cleanliness is a START condition and stays one.
 *
 * WHERE THE MARKER LIVES
 *   Inside the worktree's own git directory (`git rev-parse --absolute-git-dir`). Two reasons,
 *   both load-bearing:
 *     * `git status` never reports anything under the git directory, so the marker cannot make
 *       the tree dirty and block the next SessionStart. An untracked scratch file in the worktree
 *       is precisely what the anchor check refuses to start on.
 *     * For a linked worktree that path is `<repo>/.git/worktrees/<name>`, which is unique per
 *       worktree. The storage location is itself part of the binding.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export const MARKER_SCHEMA = 'tf-claude-guard-session-v1';

/** 12h. Long enough for a real working day, short enough that a marker left behind by a seat
 *  that died days ago cannot arm a session nobody supervised. */
export const DEFAULT_MARKER_TTL_SECONDS = 12 * 60 * 60;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Exit-code question, not an output question: `--is-ancestor` prints nothing and answers 0/1. */
function isAncestor(cwd, ancestor, descendant) {
  const r = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status === 0;
}

/**
 * Everything PreToolUse needs about the tree, in ONE `git` invocation.
 *
 * MEASURED 2026-08-16 against the real Worker-1 worktree: asking these four questions with four
 * separate `git` calls cost +81ms on EVERY tool call, on top of the doorway's own work. Process
 * spawn dominates; the queries themselves are trivial. Batching them is not micro-optimisation,
 * it is the difference between a guard people keep and a guard people switch off.
 * `A GUARD THAT BECOMES SLOW BECOMES OPTIONAL.`
 *
 * `--abbrev-ref` is placed LAST on purpose: rev-parse applies flags to the revisions that FOLLOW
 * them, so the earlier `HEAD` still prints a full sha and the trailing one prints the symbolic
 * name. On a detached HEAD that trailing value is the literal string `HEAD`, which is reported
 * as "no branch" rather than mistaken for one — no branch may be named HEAD.
 */
function repoFacts(cwd, expectedHead) {
  const out = git(cwd, ['rev-parse', '--absolute-git-dir', 'HEAD', `${expectedHead}^{commit}`, '--abbrev-ref', 'HEAD']).split('\n');
  const [gitDir, head, resolvedExpected, abbrev] = out.map((s) => s.trim());
  return { gitDir, head, resolvedExpected, branch: abbrev === 'HEAD' ? '' : abbrev };
}

/**
 * A session id is an opaque string from the harness. It reaches the filesystem, so it is
 * sanitized — but sanitizing can MERGE two distinct ids onto one filename, so the id is also
 * stored inside the marker and compared exactly. The filename is an index; the field is the
 * claim. `THE FIELD YOU READ IS THE CLAIM.`
 */
function markerFileName(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return `tf-claude-guard-session-${safe}.json`;
}

export function guardSessionMarkerDir(repoRoot) {
  return git(repoRoot, ['rev-parse', '--absolute-git-dir']);
}

export function guardSessionMarkerPath(repoRoot, sessionId) {
  return path.join(guardSessionMarkerDir(repoRoot), markerFileName(sessionId));
}

function requireSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new Error('hook input carries no session_id, so an armed session cannot be identified');
  }
  return sessionId;
}

function toolboxIdentity(manifest) {
  return {
    toolbox_pin: manifest._toolbox_pin ?? null,
    toolbox_bundle_sha256: manifest._toolbox_bundle_sha256 ?? null,
  };
}

function ttlSeconds(manifest) {
  const raw = manifest?.session_anchor?.marker_ttl_seconds;
  if (raw === undefined || raw === null) return DEFAULT_MARKER_TTL_SECONDS;
  if (!Number.isInteger(raw) || raw <= 0 || raw > 7 * 24 * 60 * 60) {
    throw new Error('session_anchor.marker_ttl_seconds must be a positive integer of at most 604800');
  }
  return raw;
}

/**
 * Called only when the anchor VERIFIED. `anchor` is the verifyResumeAnchor result, so the marker
 * records what was actually proven rather than what the manifest asked for.
 */
export function mintGuardSession({ repoRoot, sessionId, manifest, anchor, now = Date.now() }) {
  requireSessionId(sessionId);
  const armedAt = now;
  const marker = {
    schema: MARKER_SCHEMA,
    session_id: sessionId,
    worktree: path.resolve(repoRoot),
    git_dir: path.resolve(guardSessionMarkerDir(repoRoot)),
    branch: anchor.branch,
    head: anchor.head,
    expected_branch: manifest.session_anchor.expected_branch,
    ...toolboxIdentity(manifest),
    armed_at: armedAt,
    expires_at: armedAt + ttlSeconds(manifest) * 1000,
    _what_this_proves:
      'The tree was CLEAN (or dirty only at hash-pinned governed paths) on this branch at this ' +
      'commit, in this worktree, for this session, under this toolbox pin. Nothing else. Every ' +
      'other fact the guard needs is re-measured from the live tree on each tool call.',
  };
  const file = guardSessionMarkerPath(repoRoot, sessionId);
  fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`);
  return { file, marker };
}

/** Best-effort removal so a refused SessionStart cannot leave an earlier session's marker in
 *  place and let the new, unverified seat inherit it. */
export function revokeGuardSession({ repoRoot, sessionId }) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return false;
  const file = guardSessionMarkerPath(repoRoot, sessionId);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}

function fail(reason, detail = {}) {
  return { ok: false, reason, ...detail };
}

/**
 * Every check below answers "is the thing I am about to permit the same thing SessionStart
 * proved?" — and each one is stated so a reader can tell WHICH fact failed. A generic refusal is
 * how the original defect survived: the seat was denied, the denial looked deliberate, and the
 * reason was never read.
 */
export function verifyGuardSession({ repoRoot, sessionId, manifest, now = Date.now() }) {
  requireSessionId(sessionId);

  let facts;
  try {
    facts = repoFacts(repoRoot, manifest.session_anchor.expected_head);
  } catch (error) {
    // The batched read fails as a unit, so re-ask the cheap part to say WHICH half was
    // unreadable. This path is rare, so the extra spawn is free and a precise refusal is not.
    let gitDirReadable = true;
    try { git(repoRoot, ['rev-parse', '--absolute-git-dir']); } catch { gitDirReadable = false; }
    return fail(gitDirReadable
      ? `manifest expected_head ${manifest.session_anchor.expected_head} could not be resolved: ${error.message}`
      : `repository state could not be read: ${error.message}`);
  }

  const file = path.join(facts.gitDir, markerFileName(sessionId));
  if (!fs.existsSync(file)) {
    return fail('no armed guard session for this session id; SessionStart never verified the resume anchor here');
  }

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`armed guard session marker is unreadable: ${error.message}`);
  }
  if (!marker || typeof marker !== 'object' || marker.schema !== MARKER_SCHEMA) {
    return fail('armed guard session marker has an unrecognised schema');
  }

  // 1. SESSION. The filename is sanitized and can collide; the field cannot.
  if (marker.session_id !== sessionId) {
    return fail(`armed guard session belongs to session ${marker.session_id}, not ${sessionId}`);
  }

  // 2. EXPIRY, before anything expensive.
  if (typeof marker.expires_at !== 'number' || now >= marker.expires_at) {
    return fail('armed guard session has expired; start a new session so the resume anchor is re-verified');
  }

  // 3. PLACE. A marker carried into another checkout is the fail-OPEN shape this design exists
  //    to refuse — same session id, same branch name, different tree.
  const liveRoot = path.resolve(repoRoot);
  const liveGitDir = path.resolve(facts.gitDir);
  if (marker.worktree !== liveRoot) {
    return fail(`armed guard session was minted in worktree ${marker.worktree}, not ${liveRoot}`);
  }
  if (marker.git_dir !== liveGitDir) {
    return fail(`armed guard session was minted against git directory ${marker.git_dir}, not ${liveGitDir}`);
  }

  // 4. LAW. A re-pin is a deliberate change of the rules. A session armed under the old pin must
  //    not keep running under the new one on the strength of a marker minted before the change.
  const expectedToolbox = toolboxIdentity(manifest);
  if (marker.toolbox_pin !== expectedToolbox.toolbox_pin) {
    return fail(`armed guard session was minted under toolbox pin ${marker.toolbox_pin}, manifest now pins ${expectedToolbox.toolbox_pin}`);
  }
  if (marker.toolbox_bundle_sha256 !== expectedToolbox.toolbox_bundle_sha256) {
    return fail('armed guard session was minted under a different toolbox bundle than the manifest now declares');
  }

  // 5. BRANCH, re-measured. Not "what the marker remembers" — what the tree says right now.
  const expectedBranch = manifest.session_anchor.expected_branch;
  const liveBranch = facts.branch;
  if (liveBranch !== expectedBranch) {
    return fail(`branch moved since the session was armed: expected ${expectedBranch}, now ${liveBranch || '(detached)'}`);
  }
  if (marker.branch !== expectedBranch) {
    return fail(`armed guard session was minted on branch ${marker.branch}, manifest expects ${expectedBranch}`);
  }

  // 6. HEAD, re-measured, and ADVANCE-ONLY.
  //    The seat is expected to commit while it works, so a frozen HEAD would brick it after its
  //    first commit. What must never happen is HEAD going BACKWARDS or sideways off the armed
  //    commit: a reset, a rebase or a checkout re-writes the ground the anchor was proven on.
  //    So: HEAD must still be the tip of the expected ref, and the armed commit must still be an
  //    ancestor of it.
  const { head: liveHead, resolvedExpected } = facts;
  if (liveHead !== resolvedExpected) {
    return fail(`HEAD is not at the expected anchor: expected ${resolvedExpected}, got ${liveHead}`);
  }
  if (liveHead !== marker.head && !isAncestor(repoRoot, marker.head, liveHead)) {
    return fail(`HEAD ${liveHead} does not descend from the armed anchor ${marker.head}; history was rewritten under a live session`);
  }

  return { ok: true, marker, head: liveHead, branch: liveBranch };
}
