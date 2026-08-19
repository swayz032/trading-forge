#!/usr/bin/env node
/**
 * AR-1358 A2 repair — monotonic parent-history witness for isolated grader authority.
 *
 * The ordinary Worker session marker proves the current branch/head descends from the head seen at
 * SessionStart. That current-state proof is necessary, but by itself it cannot distinguish:
 *
 *   SessionStart H1 -> advance H2 -> reset H1
 *
 * from a session that simply stayed at H1. AR-1358 independently demonstrated that replay shape
 * could mint a fresh isolated-grader token after a history rewind.
 *
 * This module adds a permit-specific historical witness WITHOUT changing normal Worker authority:
 * after a successful normal SessionStart, the runner stamps the current branch reflog length into
 * the already self-protected armed-session marker. Before permit issuance, before token redemption,
 * and before every active isolated-grader execution, all reflog entries added since that exact
 * SessionStart are replayed oldest->newest and every transition must be fast-forward/equal.
 *
 * Any reflog shrink, missing baseline, non-fast-forward transition, or unaccounted current tip
 * fails CLOSED for isolated-grader authority only. Normal Worker execution keeps its existing law.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  guardSessionMarkerPath,
  verifyGuardSession,
} from './guard-session-marker.mjs';

export const PARENT_HISTORY_SCHEMA = 'tf-isolated-grader-parent-history-v1';
const ACTIVATION_RE = /^echo\s+TF_ISOLATED_GRADER_ACTIVATE:([a-f0-9]{64})$/i;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function isAncestor(cwd, ancestor, descendant) {
  const r = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return r.status === 0;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function commonGitDir(repoRoot) {
  const raw = git(repoRoot, ['rev-parse', '--git-common-dir']);
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(repoRoot, raw));
}

function reflogHeads(repoRoot, branch) {
  const out = git(repoRoot, ['reflog', 'show', '--format=%H', branch]);
  const heads = out.split('\n').map((x) => x.trim()).filter(Boolean);
  if (heads.length === 0) throw new Error(`branch ${branch} has no readable reflog entries`);
  return heads; // newest -> oldest
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function atomicWriteJson(file, value) {
  const tmp = `${file}.grader-history-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(tmp, file);
}

function fail(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

export function isIsolatedGraderDispatch(input) {
  const t = input?.tool_input || {};
  return input?.hook_event_name === 'PreToolUse'
    && input?.tool_name === 'Agent'
    && t.subagent_type === 'accuracy-validator'
    && t.isolation === 'worktree';
}

/**
 * Called immediately after a normal SessionStart successfully minted the ordinary armed marker.
 * The marker is already a self-protected file in the worktree git dir, so the baseline lives with
 * the authority it qualifies instead of creating a second mutable control file.
 */
export function stampIsolatedGraderParentHistory({ repoRoot, sessionId, manifest, now = Date.now() }) {
  const parent = verifyGuardSession({ repoRoot, sessionId, manifest, now });
  if (!parent.ok) throw new Error(`cannot stamp grader parent history on unarmed session: ${parent.reason}`);

  const file = guardSessionMarkerPath(repoRoot, sessionId);
  const marker = readJson(file);
  const heads = reflogHeads(repoRoot, parent.branch);
  if (heads[0] !== parent.head) {
    throw new Error(`branch reflog current tip ${heads[0]} != armed live HEAD ${parent.head}`);
  }

  marker.isolated_grader_parent_history = {
    schema: PARENT_HISTORY_SCHEMA,
    branch: parent.branch,
    baseline_head: parent.head,
    reflog_entry_count: heads.length,
    stamped_at: now,
  };
  atomicWriteJson(file, marker);
  return marker.isolated_grader_parent_history;
}

/**
 * Prove that every branch-ref transition observed after SessionStart was monotonic. Reflog count
 * gives an exact session boundary without depending on second-resolution timestamps.
 */
export function verifyIsolatedGraderParentHistory({ repoRoot, sessionId, manifest, now = Date.now() }) {
  const parent = verifyGuardSession({ repoRoot, sessionId, manifest, now });
  if (!parent.ok) return fail(`ordinary parent session is not armed: ${parent.reason}`);

  const baseline = parent.marker?.isolated_grader_parent_history;
  if (!baseline || baseline.schema !== PARENT_HISTORY_SCHEMA) {
    return fail('parent session has no isolated-grader history baseline from its SessionStart');
  }
  if (baseline.branch !== parent.branch || baseline.baseline_head !== parent.marker.head) {
    return fail('parent grader-history baseline does not match the armed session branch/head');
  }
  if (!Number.isInteger(baseline.reflog_entry_count) || baseline.reflog_entry_count <= 0) {
    return fail('parent grader-history baseline has an invalid reflog entry count');
  }

  let heads;
  try {
    heads = reflogHeads(repoRoot, parent.branch);
  } catch (error) {
    return fail(`parent branch reflog cannot be verified: ${error.message}`);
  }
  if (heads.length < baseline.reflog_entry_count) {
    return fail(
      `parent branch reflog shrank from ${baseline.reflog_entry_count} to ${heads.length} entries after SessionStart`,
    );
  }

  const addedCount = heads.length - baseline.reflog_entry_count;
  const addedChronological = heads.slice(0, addedCount).reverse();
  let previous = baseline.baseline_head;
  for (const next of addedChronological) {
    if (next === previous) continue;
    if (!isAncestor(repoRoot, previous, next)) {
      return fail(
        `parent branch history was rewritten after SessionStart: ${next} does not descend from prior observed tip ${previous}`,
        { prior_tip: previous, rewritten_tip: next },
      );
    }
    previous = next;
  }

  if (previous !== parent.head) {
    return fail(
      `parent current HEAD ${parent.head} is not accounted for by the post-SessionStart reflog chain ending at ${previous}`,
    );
  }

  return {
    ok: true,
    parent,
    baseline,
    added_count: addedCount,
    current_head: parent.head,
  };
}

export function verifyParentHistoryForDispatch({ input, manifest, repoRoot, now = Date.now() }) {
  if (!isIsolatedGraderDispatch(input)) return { applicable: false, ok: true };
  return {
    applicable: true,
    ...verifyIsolatedGraderParentHistory({
      repoRoot,
      sessionId: input.session_id,
      manifest,
      now,
    }),
  };
}

function activationToken(input) {
  if (input?.hook_event_name !== 'PreToolUse') return null;
  if (input?.tool_name !== 'Bash' && input?.tool_name !== 'PowerShell') return null;
  const command = input?.tool_input?.command;
  if (typeof command !== 'string') return null;
  const m = command.trim().match(ACTIVATION_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Before the child consumes a token, recover the permit's parent binding and re-run the same
 * monotonic-history proof. Missing/malformed permit is denied here rather than delegated through
 * an unverified path; the child handler will never get a chance to consume it.
 */
export function verifyActivationParentHistory({ input, manifest, repoRoot, now = Date.now() }) {
  const token = activationToken(input);
  if (!token) return { applicable: false, ok: true };

  const tokenHash = sha256(token);
  const permitFile = path.join(commonGitDir(repoRoot), 'tf-isolated-grader-permits', `${tokenHash}.json`);
  if (!fs.existsSync(permitFile)) {
    return { applicable: true, ok: false, reason: 'no unconsumed isolated-grader permit matches this activation token' };
  }

  let permit;
  try { permit = readJson(permitFile); } catch (error) {
    return { applicable: true, ok: false, reason: `activation permit is unreadable: ${error.message}` };
  }
  if (!permit.parent_worktree || !permit.parent_session_id) {
    return { applicable: true, ok: false, reason: 'activation permit has no bound parent session/worktree' };
  }

  return {
    applicable: true,
    ...verifyIsolatedGraderParentHistory({
      repoRoot: permit.parent_worktree,
      sessionId: permit.parent_session_id,
      manifest,
      now,
    }),
  };
}

/** Continuous parent authority for an already-activated grader. */
export function verifyActiveGraderParentHistory({ isolatedSession, manifest, now = Date.now() }) {
  const marker = isolatedSession?.marker;
  if (!marker?.parent_worktree || !marker?.parent_session_id) {
    return fail('active isolated grader marker has no bound parent session/worktree');
  }
  return verifyIsolatedGraderParentHistory({
    repoRoot: marker.parent_worktree,
    sessionId: marker.parent_session_id,
    manifest,
    now,
  });
}

/** Remove a just-minted token if a post-mint continuity check fails before its prompt is emitted. */
export function revokeIssuedPermit({ result, repoRoot }) {
  const tokenHash = result?._audit?.isolated_grader_permit?.token_sha256;
  if (!tokenHash || !/^[a-f0-9]{64}$/i.test(tokenHash)) return false;
  const file = path.join(commonGitDir(repoRoot), 'tf-isolated-grader-permits', `${tokenHash}.json`);
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file, { force: true });
  return true;
}
