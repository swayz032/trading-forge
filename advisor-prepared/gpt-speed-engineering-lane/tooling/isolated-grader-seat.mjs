#!/usr/bin/env node
/**
 * AR-1354A isolated-grader seat compatibility.
 *
 * Problem: Agent isolation:"worktree" creates a synthetic worktree-agent-* branch with its own
 * git dir/session id. The normal Worker-1 SessionStart anchor correctly refuses that branch, so
 * the accuracy-validator can Read/Grep but every guarded execution tool is denied.
 *
 * This module does NOT widen the normal Worker seat. It adds a separate one-time capability for
 * exactly an accuracy-validator dispatched with isolation:"worktree":
 *
 *   parent armed session -> PreToolUse(Agent) -> one-use random permit (hash stored under common
 *   git dir) -> token injected into ONLY that Agent prompt -> child synthetic worktree starts
 *   UNARMED -> child must redeem token with one exact activation Bash command -> child gets a
 *   read/test-only marker bound to child session/worktree/git-dir/common-dir/branch/HEAD + parent
 *   session + toolbox identity -> every later guarded call re-verifies those facts.
 *
 * An unrelated worktree-agent-* has no plaintext token. The permit file stores only its SHA256,
 * is one-use, short-lived, and is accepted only when the parent session is still genuinely armed.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyGuardSession } from './guard-session-marker.mjs';

export const PERMIT_SCHEMA = 'tf-isolated-grader-permit-v1';
export const SESSION_SCHEMA = 'tf-isolated-grader-session-v1';
export const PERMIT_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const ACTIVATION_PREFIX = 'TF_ISOLATED_GRADER_ACTIVATE:';
const AGENT_BRANCH = /^worktree-agent-[A-Za-z0-9_-]+$/;

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function resolved(p) {
  return path.resolve(p);
}

function commonGitDir(repoRoot) {
  const raw = git(repoRoot, ['rev-parse', '--git-common-dir']);
  return resolved(path.isAbsolute(raw) ? raw : path.join(repoRoot, raw));
}

function gitDir(repoRoot) {
  return resolved(git(repoRoot, ['rev-parse', '--absolute-git-dir']));
}

function repoFacts(repoRoot, expectedHead) {
  const branch = git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const expected = expectedHead ? git(repoRoot, ['rev-parse', `${expectedHead}^{commit}`]) : null;
  return {
    worktree: resolved(repoRoot),
    git_dir: gitDir(repoRoot),
    common_git_dir: commonGitDir(repoRoot),
    branch,
    head,
    expected,
  };
}

function toolboxIdentity(manifest) {
  return {
    toolbox_pin: manifest?._toolbox_pin ?? null,
    toolbox_bundle_sha256: manifest?._toolbox_bundle_sha256 ?? null,
  };
}

function permitDir(common) {
  return path.join(common, 'tf-isolated-grader-permits');
}

function permitPath(common, tokenHash) {
  return path.join(permitDir(common), `${tokenHash}.json`);
}

function consumedPermitPath(common, tokenHash, childSessionId) {
  const safe = String(childSessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(permitDir(common), `${tokenHash}.consumed-${safe}.json`);
}

function isolatedSessionPath(repoRoot, sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return path.join(gitDir(repoRoot), `tf-isolated-grader-session-${safe}.json`);
}

function canonicalAgentRequest(toolInput) {
  return JSON.stringify({
    description: typeof toolInput?.description === 'string' ? toolInput.description : null,
    prompt: typeof toolInput?.prompt === 'string' ? toolInput.prompt : null,
    subagent_type: typeof toolInput?.subagent_type === 'string' ? toolInput.subagent_type : null,
    model: typeof toolInput?.model === 'string' ? toolInput.model : null,
    isolation: typeof toolInput?.isolation === 'string' ? toolInput.isolation : null,
  });
}

function isEligibleRequest(input) {
  const t = input?.tool_input || {};
  return input?.tool_name === 'Agent'
    && t.subagent_type === 'accuracy-validator'
    && t.isolation === 'worktree'
    && typeof t.prompt === 'string'
    && t.prompt.trim() !== '';
}

function hasDenial(result) {
  return result?.hookSpecificOutput?.permissionDecision === 'deny'
    || result?.decision === 'block';
}

function touchesG2(result) {
  const a = result?._audit || {};
  return Boolean(a.g2 || a.g2_error || a.g2_postcall || a.g2_postcall_error);
}

function writePermit(file, permit) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // wx: a token hash is unique; collision/reuse is a hard failure, never overwrite authority.
  fs.writeFileSync(file, `${JSON.stringify(permit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

/** Called only AFTER the normal guard has allowed the parent Agent call. */
export function authorizeIsolatedGraderDispatch({ input, manifest, repoRoot, baseResult, now = Date.now() }) {
  if (!isEligibleRequest(input) || hasDenial(baseResult) || touchesG2(baseResult)) return null;

  const parent = verifyGuardSession({ repoRoot, sessionId: input.session_id, manifest, now });
  if (!parent.ok) throw new Error(`cannot issue isolated-grader permit from unarmed parent: ${parent.reason}`);

  const facts = repoFacts(repoRoot, manifest.session_anchor.expected_head);
  if (facts.branch !== manifest.session_anchor.expected_branch || facts.head !== facts.expected) {
    throw new Error('parent moved off its verified branch/head before isolated-grader permit issuance');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const permit = {
    schema: PERMIT_SCHEMA,
    token_sha256: tokenHash,
    parent_session_id: input.session_id,
    parent_worktree: facts.worktree,
    parent_git_dir: facts.git_dir,
    common_git_dir: facts.common_git_dir,
    parent_branch: facts.branch,
    parent_head: facts.head,
    tool_use_id: input.tool_use_id ?? null,
    agent_request_sha256: sha256(canonicalAgentRequest(input.tool_input)),
    subagent_type: 'accuracy-validator',
    isolation: 'worktree',
    ...toolboxIdentity(manifest),
    issued_at: now,
    expires_at: now + PERMIT_TTL_MS,
    consumed: false,
  };
  writePermit(permitPath(facts.common_git_dir, tokenHash), permit);

  const activation = `echo ${ACTIVATION_PREFIX}${token}`;
  const prompt = [
    input.tool_input.prompt,
    '',
    'GUARDED ISOLATED GRADER ACTIVATION (load-bearing):',
    `Before any execution tool, run this exact Bash command once: ${activation}`,
    'The resulting seat is grader-only: Edit/Write/NotebookEdit and nested Agent/Task calls remain denied.',
    'If activation is refused, STOP and report the guard reason; do not work around it.',
  ].join('\n');

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'authorized one-use isolated accuracy-validator seat',
      updatedInput: { ...input.tool_input, prompt },
    },
    _audit: {
      ...(baseResult?._audit || {}),
      isolated_grader_permit: {
        token_sha256: tokenHash,
        parent_session_id: input.session_id,
        parent_head: facts.head,
        expires_at: permit.expires_at,
      },
    },
  };
}

/**
 * SessionStart never arms a synthetic branch. It only gives precise context so the intended
 * grader knows that redemption, not a blanket branch exception, is the next step.
 */
export function isolatedGraderSessionStart({ input, manifest, repoRoot }) {
  if (input?.hook_event_name !== 'SessionStart') return null;
  let facts;
  try { facts = repoFacts(repoRoot, manifest.session_anchor.expected_head); } catch { return null; }
  if (!AGENT_BRANCH.test(facts.branch)) return null;

  const trackedDirty = git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=no']);
  const exactBase = facts.head === facts.expected;
  const clean = trackedDirty === '';
  const ready = exactBase && clean;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: ready
        ? 'GPT isolated grader: synthetic worktree detected at the exact parent HEAD. This session is NOT armed yet. Run the one-use activation command injected into your task prompt before any execution tool. Edits and nested agents will remain denied.'
        : `GPT worker guard STOP: isolated grader worktree preconditions failed (${exactBase ? '' : 'HEAD is not the current parent anchor; '}${clean ? '' : 'tracked tree is dirty'}). Do not execute.`,
    },
    _audit: { event: 'SessionStart', isolated_grader_pending: ready, facts },
  };
}

function parseActivation(command) {
  if (typeof command !== 'string') return null;
  const m = command.trim().match(/^echo\s+TF_ISOLATED_GRADER_ACTIVATE:([a-f0-9]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function trackedTreeClean(repoRoot) {
  return git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=no']) === '';
}

function verifyPermit({ repoRoot, sessionId, manifest, token, now }) {
  const facts = repoFacts(repoRoot, manifest.session_anchor.expected_head);
  if (!AGENT_BRANCH.test(facts.branch)) return { ok: false, reason: `branch ${facts.branch} is not an isolated Agent worktree` };
  if (!trackedTreeClean(repoRoot)) return { ok: false, reason: 'isolated grader tracked tree is dirty before activation' };

  const tokenHash = sha256(token);
  const file = permitPath(facts.common_git_dir, tokenHash);
  if (!fs.existsSync(file)) return { ok: false, reason: 'no unconsumed isolated-grader permit matches this activation token' };

  let permit;
  try { permit = readJson(file); } catch (error) { return { ok: false, reason: `isolated-grader permit unreadable: ${error.message}` }; }
  if (permit.schema !== PERMIT_SCHEMA) return { ok: false, reason: 'isolated-grader permit schema mismatch' };
  if (permit.token_sha256 !== tokenHash) return { ok: false, reason: 'isolated-grader permit token hash mismatch' };
  if (permit.consumed === true) return { ok: false, reason: 'isolated-grader permit is already consumed' };
  if (typeof permit.expires_at !== 'number' || now >= permit.expires_at) return { ok: false, reason: 'isolated-grader permit expired' };
  if (permit.subagent_type !== 'accuracy-validator' || permit.isolation !== 'worktree') {
    return { ok: false, reason: 'permit is not for an isolated accuracy-validator' };
  }
  if (resolved(permit.common_git_dir) !== facts.common_git_dir) return { ok: false, reason: 'permit belongs to a different repository common git dir' };
  if (permit.parent_head !== facts.head) return { ok: false, reason: `isolated grader HEAD ${facts.head} != permitted parent HEAD ${permit.parent_head}` };
  const ident = toolboxIdentity(manifest);
  if (permit.toolbox_pin !== ident.toolbox_pin || permit.toolbox_bundle_sha256 !== ident.toolbox_bundle_sha256) {
    return { ok: false, reason: 'permit was issued under a different toolbox identity' };
  }

  const parent = verifyGuardSession({
    repoRoot: permit.parent_worktree,
    sessionId: permit.parent_session_id,
    manifest,
    now,
  });
  if (!parent.ok) return { ok: false, reason: `parent session is no longer armed: ${parent.reason}` };

  // Consume by atomic rename before minting the child marker. Two children racing one token cannot
  // both win; only the first rename can succeed.
  const consumed = consumedPermitPath(facts.common_git_dir, tokenHash, sessionId);
  try { fs.renameSync(file, consumed); } catch (error) {
    return { ok: false, reason: `isolated-grader permit could not be consumed atomically: ${error.message}` };
  }

  const consumedBody = fs.readFileSync(consumed, 'utf8');
  const consumedSha = sha256(consumedBody);
  return { ok: true, permit, facts, tokenHash, consumed, consumedSha };
}

function mintIsolatedSession({ repoRoot, sessionId, manifest, verified, now }) {
  const marker = {
    schema: SESSION_SCHEMA,
    session_id: sessionId,
    mode: 'isolated-grader',
    worktree: verified.facts.worktree,
    git_dir: verified.facts.git_dir,
    common_git_dir: verified.facts.common_git_dir,
    branch: verified.facts.branch,
    head: verified.facts.head,
    parent_session_id: verified.permit.parent_session_id,
    parent_worktree: verified.permit.parent_worktree,
    consumed_permit_path: verified.consumed,
    consumed_permit_sha256: verified.consumedSha,
    token_sha256: verified.tokenHash,
    ...toolboxIdentity(manifest),
    armed_at: now,
    expires_at: Math.min(now + SESSION_TTL_MS, verified.permit.expires_at + SESSION_TTL_MS),
  };
  const file = isolatedSessionPath(repoRoot, sessionId);
  fs.writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return marker;
}

export function verifyIsolatedGraderSession({ repoRoot, sessionId, manifest, now = Date.now() }) {
  const file = isolatedSessionPath(repoRoot, sessionId);
  if (!fs.existsSync(file)) return { ok: false, reason: 'isolated grader session is not activated' };
  let marker;
  try { marker = readJson(file); } catch (error) { return { ok: false, reason: `isolated grader session marker unreadable: ${error.message}` }; }
  if (marker.schema !== SESSION_SCHEMA || marker.mode !== 'isolated-grader') return { ok: false, reason: 'isolated grader marker schema/mode mismatch' };
  if (marker.session_id !== sessionId) return { ok: false, reason: 'isolated grader marker belongs to a different session' };
  if (typeof marker.expires_at !== 'number' || now >= marker.expires_at) return { ok: false, reason: 'isolated grader session expired' };

  const facts = repoFacts(repoRoot, manifest.session_anchor.expected_head);
  if (!AGENT_BRANCH.test(facts.branch)) return { ok: false, reason: 'isolated grader no longer runs on a worktree-agent-* branch' };
  for (const [field, live] of [
    ['worktree', facts.worktree],
    ['git_dir', facts.git_dir],
    ['common_git_dir', facts.common_git_dir],
    ['branch', facts.branch],
    ['head', facts.head],
  ]) {
    if (marker[field] !== live) return { ok: false, reason: `isolated grader ${field} changed since activation` };
  }
  const ident = toolboxIdentity(manifest);
  if (marker.toolbox_pin !== ident.toolbox_pin || marker.toolbox_bundle_sha256 !== ident.toolbox_bundle_sha256) {
    return { ok: false, reason: 'isolated grader marker was minted under a different toolbox identity' };
  }
  if (!trackedTreeClean(repoRoot)) return { ok: false, reason: 'isolated grader modified tracked files; execution is frozen' };
  if (!fs.existsSync(marker.consumed_permit_path)) return { ok: false, reason: 'consumed isolated-grader permit witness disappeared' };
  if (sha256(fs.readFileSync(marker.consumed_permit_path, 'utf8')) !== marker.consumed_permit_sha256) {
    return { ok: false, reason: 'consumed isolated-grader permit witness changed after activation' };
  }
  const parent = verifyGuardSession({
    repoRoot: marker.parent_worktree,
    sessionId: marker.parent_session_id,
    manifest,
    now,
  });
  if (!parent.ok) return { ok: false, reason: `parent session is no longer armed: ${parent.reason}` };
  return { ok: true, marker, facts };
}

/**
 * Returns null when this is not a synthetic isolated-grader worktree. Otherwise returns a full
 * hook result and NEVER delegates the guarded call to the normal Worker branch law.
 */
export function handleIsolatedGraderPreToolUse({ input, manifest, repoRoot, now = Date.now() }) {
  if (input?.hook_event_name !== 'PreToolUse') return null;
  let facts;
  try { facts = repoFacts(repoRoot, manifest.session_anchor.expected_head); } catch { return null; }
  if (!AGENT_BRANCH.test(facts.branch)) return null;

  const active = verifyIsolatedGraderSession({ repoRoot, sessionId: input.session_id, manifest, now });
  if (active.ok) return { handled: true, active: true, session: active };

  if (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') {
    const token = parseActivation(input.tool_input?.command);
    if (token) {
      const verified = verifyPermit({ repoRoot, sessionId: input.session_id, manifest, token, now });
      if (!verified.ok) {
        return { handled: true, active: false, result: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `isolated grader activation refused: ${verified.reason}`,
          },
          _audit: { event: 'PreToolUse', isolated_grader_activation: verified },
        } };
      }
      try {
        const marker = mintIsolatedSession({ repoRoot, sessionId: input.session_id, manifest, verified, now });
        return { handled: true, active: false, result: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: 'isolated accuracy-validator seat activated; grader-only restrictions remain in force',
          },
          _audit: { event: 'PreToolUse', isolated_grader_activation: { ok: true, marker } },
        } };
      } catch (error) {
        return { handled: true, active: false, result: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `isolated grader activation failed closed: ${error.message}`,
          },
          _audit: { event: 'PreToolUse', isolated_grader_activation_error: error.message },
        } };
      }
    }
  }

  return { handled: true, active: false, result: {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `isolated grader seat is not activated: ${active.reason}. Run the exact one-use activation command from the task prompt.`,
    },
    _audit: { event: 'PreToolUse', isolated_grader_unarmed: active },
  } };
}
