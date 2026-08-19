#!/usr/bin/env node
/**
 * AR-1354A isolated accuracy-validator seat.
 *
 * The normal Worker guard stays unchanged and fail-closed. A parent Worker session that is
 * already armed may issue ONE short-lived capability only for Agent{subagent_type:
 * "accuracy-validator", isolation:"worktree"}. The secret token is injected into that exact
 * agent prompt; only its SHA256 is persisted. The synthetic child worktree must redeem the token
 * once before any guarded execution. The resulting marker is bound to child session/worktree/
 * git-dir/common-git-dir/branch/HEAD, the parent session, and the toolbox identity.
 *
 * Cleanliness is an ACTIVATION condition, matching the normal Worker marker law. A real test may
 * legitimately regenerate a tracked artifact inside its disposable worktree; that must not brick
 * the grader's next inspection command. HEAD, identity, permit witness and parent authorization
 * remain continuously re-verified. Direct Edit/Write and nested Agent/Task are denied by runner.
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

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function resolved(p) {
  return path.resolve(p);
}

function gitDir(repoRoot) {
  return resolved(git(repoRoot, ['rev-parse', '--absolute-git-dir']));
}

function commonGitDir(repoRoot) {
  const raw = git(repoRoot, ['rev-parse', '--git-common-dir']);
  return resolved(path.isAbsolute(raw) ? raw : path.join(repoRoot, raw));
}

function repoFacts(repoRoot, expectedHead) {
  return {
    worktree: resolved(repoRoot),
    git_dir: gitDir(repoRoot),
    common_git_dir: commonGitDir(repoRoot),
    branch: git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    head: git(repoRoot, ['rev-parse', 'HEAD']),
    expected: expectedHead ? git(repoRoot, ['rev-parse', `${expectedHead}^{commit}`]) : null,
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

function consumedPermitPath(common, tokenHash, sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(permitDir(common), `${tokenHash}.consumed-${safe}.json`);
}

function sessionPath(repoRoot, sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return path.join(gitDir(repoRoot), `tf-isolated-grader-session-${safe}.json`);
}

function trackedTreeClean(repoRoot) {
  return git(repoRoot, ['status', '--porcelain=v1', '--untracked-files=no']) === '';
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

function eligible(input) {
  const t = input?.tool_input || {};
  return input?.tool_name === 'Agent'
    && t.subagent_type === 'accuracy-validator'
    && t.isolation === 'worktree'
    && typeof t.prompt === 'string'
    && t.prompt.trim() !== '';
}

function baseDenied(result) {
  return result?.hookSpecificOutput?.permissionDecision === 'deny' || result?.decision === 'block';
}

function baseTouchesG2(result) {
  const a = result?._audit || {};
  return Boolean(a.g2 || a.g2_error || a.g2_postcall || a.g2_postcall_error);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Parent side: called only after the ordinary Worker guard has evaluated the Agent request. */
export function authorizeIsolatedGraderDispatch({ input, manifest, repoRoot, baseResult, now = Date.now() }) {
  if (!eligible(input) || baseDenied(baseResult) || baseTouchesG2(baseResult)) return null;

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
  };

  const file = permitPath(facts.common_git_dir, tokenHash);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(permit, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });

  const activation = `echo ${ACTIVATION_PREFIX}${token}`;
  const prompt = [
    input.tool_input.prompt,
    '',
    'GUARDED ISOLATED GRADER ACTIVATION (load-bearing):',
    `Before any execution tool, run this exact Bash command once: ${activation}`,
    'This is a grader-only seat: Edit/Write/NotebookEdit and nested Agent/Task remain denied.',
    'If activation is refused, STOP and report the exact guard reason; do not work around it.',
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

/** Child SessionStart stays unarmed; it only reports whether redemption preconditions exist. */
export function isolatedGraderSessionStart({ input, manifest, repoRoot }) {
  if (input?.hook_event_name !== 'SessionStart') return null;
  let facts;
  try { facts = repoFacts(repoRoot, manifest.session_anchor.expected_head); } catch { return null; }
  if (!AGENT_BRANCH.test(facts.branch)) return null;

  const exactBase = facts.head === facts.expected;
  const clean = trackedTreeClean(repoRoot);
  const ready = exactBase && clean;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: ready
        ? 'GPT isolated grader: synthetic worktree detected at the exact parent HEAD. This session is NOT armed yet. Run the one-use activation command injected into your task prompt before any execution tool. Edits and nested agents remain denied.'
        : `GPT worker guard STOP: isolated grader preconditions failed (${exactBase ? '' : 'HEAD is not the current parent anchor; '}${clean ? '' : 'tracked tree is dirty'}). Do not execute.`,
    },
    _audit: { event: 'SessionStart', isolated_grader_pending: ready, facts },
  };
}

function activationToken(command) {
  if (typeof command !== 'string') return null;
  const m = command.trim().match(/^echo\s+TF_ISOLATED_GRADER_ACTIVATE:([a-f0-9]{64})$/i);
  return m ? m[1].toLowerCase() : null;
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
  if (permit.schema !== PERMIT_SCHEMA || permit.token_sha256 !== tokenHash) return { ok: false, reason: 'isolated-grader permit identity mismatch' };
  if (typeof permit.expires_at !== 'number' || now >= permit.expires_at) return { ok: false, reason: 'isolated-grader permit expired' };
  if (permit.subagent_type !== 'accuracy-validator' || permit.isolation !== 'worktree') return { ok: false, reason: 'permit is not for an isolated accuracy-validator' };
  if (resolved(permit.common_git_dir) !== facts.common_git_dir) return { ok: false, reason: 'permit belongs to a different repository common git dir' };
  if (permit.parent_head !== facts.head) return { ok: false, reason: `isolated grader HEAD ${facts.head} != permitted parent HEAD ${permit.parent_head}` };

  const ident = toolboxIdentity(manifest);
  if (permit.toolbox_pin !== ident.toolbox_pin || permit.toolbox_bundle_sha256 !== ident.toolbox_bundle_sha256) {
    return { ok: false, reason: 'permit was issued under a different toolbox identity' };
  }

  const parent = verifyGuardSession({ repoRoot: permit.parent_worktree, sessionId: permit.parent_session_id, manifest, now });
  if (!parent.ok) return { ok: false, reason: `parent session is no longer armed: ${parent.reason}` };

  // Atomic rename is the one-use transition. A second child racing the same token cannot win.
  const consumed = consumedPermitPath(facts.common_git_dir, tokenHash, sessionId);
  try { fs.renameSync(file, consumed); } catch (error) {
    return { ok: false, reason: `isolated-grader permit could not be consumed atomically: ${error.message}` };
  }
  const consumedSha = sha256(fs.readFileSync(consumed, 'utf8'));
  return { ok: true, permit, facts, tokenHash, consumed, consumedSha };
}

function mintSession({ repoRoot, sessionId, manifest, verified, now }) {
  const marker = {
    schema: SESSION_SCHEMA,
    mode: 'isolated-grader',
    session_id: sessionId,
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
    expires_at: now + SESSION_TTL_MS,
  };
  fs.writeFileSync(sessionPath(repoRoot, sessionId), `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return marker;
}

export function verifyIsolatedGraderSession({ repoRoot, sessionId, manifest, now = Date.now() }) {
  const file = sessionPath(repoRoot, sessionId);
  if (!fs.existsSync(file)) return { ok: false, reason: 'isolated grader session is not activated' };

  let marker;
  try { marker = readJson(file); } catch (error) { return { ok: false, reason: `isolated grader marker unreadable: ${error.message}` }; }
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
  if (!fs.existsSync(marker.consumed_permit_path)) return { ok: false, reason: 'consumed isolated-grader permit witness disappeared' };
  if (sha256(fs.readFileSync(marker.consumed_permit_path, 'utf8')) !== marker.consumed_permit_sha256) {
    return { ok: false, reason: 'consumed isolated-grader permit witness changed after activation' };
  }

  const parent = verifyGuardSession({ repoRoot: marker.parent_worktree, sessionId: marker.parent_session_id, manifest, now });
  if (!parent.ok) return { ok: false, reason: `parent session is no longer armed: ${parent.reason}` };
  return { ok: true, marker, facts };
}

/** Child side. null means this is not a synthetic worktree-agent-* checkout. */
export function handleIsolatedGraderPreToolUse({ input, manifest, repoRoot, now = Date.now() }) {
  if (input?.hook_event_name !== 'PreToolUse') return null;
  let facts;
  try { facts = repoFacts(repoRoot, manifest.session_anchor.expected_head); } catch { return null; }
  if (!AGENT_BRANCH.test(facts.branch)) return null;

  const active = verifyIsolatedGraderSession({ repoRoot, sessionId: input.session_id, manifest, now });
  if (active.ok) return { handled: true, active: true, session: active };

  if (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') {
    const token = activationToken(input.tool_input?.command);
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
        const marker = mintSession({ repoRoot, sessionId: input.session_id, manifest, verified, now });
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
