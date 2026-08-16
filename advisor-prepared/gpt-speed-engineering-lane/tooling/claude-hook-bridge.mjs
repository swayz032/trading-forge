#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyResumeAnchor } from './resume-anchor-guard.mjs';
import { auditPaths, decideEditPermission, bashProtectedSurfaceReason } from './lane-boundary-guard.mjs';
import { evaluateScope } from './edit-scope-guard.mjs';
import { runClaudeFinishCheck } from './claude-finish-check.mjs';
import {
  loadG2Context,
  evaluateG2PreCall,
  loadNativeCallManifest,
  SUBAGENT_TOOL_NAMES,
} from './g2-precall-guard.mjs';
import { mintGuardSession, revokeGuardSession, verifyGuardSession } from './guard-session-marker.mjs';

// Re-exported for the lifecycle red proofs: those controls must be able to place a marker where
// the guard will actually look for it, and re-deriving the path in the test would be the second
// copy that drifts.
export { guardSessionMarkerPath } from './guard-session-marker.mjs';

const GUARDED_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function block(reason) {
  return { decision: 'block', reason };
}

function getRepoRoot(cwd) {
  return git(cwd, ['rev-parse', '--show-toplevel']);
}

function normalizeToolPath(repoRoot, cwd, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new Error('tool path must be a non-empty string');
  }
  const absolute = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(cwd, rawPath);
  const root = path.resolve(repoRoot);
  const rel = path.relative(root, absolute).replaceAll('\\', '/');
  if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) {
    throw new Error(`tool path escapes repository root: ${rawPath}`);
  }
  return rel;
}

function extractEditPaths(input, repoRoot) {
  const toolInput = input.tool_input || {};
  const candidates = [toolInput.file_path, toolInput.notebook_path].filter((x) => typeof x === 'string' && x.trim() !== '');
  if (candidates.length === 0) throw new Error(`cannot prove target path for ${input.tool_name}`);
  return [...new Set(candidates.map((p) => normalizeToolPath(repoRoot, input.cwd || repoRoot, p)))];
}

// Exported for the AR-1270 §B RED PROOFS only. Those controls must be able to assert that the
// OLD boundary does not recognise a shape, because "the blacklist returns null" is precisely what
// used to mean ALLOWED. Asserting that against an inaccessible function is not possible, and
// re-implementing the regexes in the test would be the second copy that drifts.
export function bashMutationReason(command) {
  if (typeof command !== 'string' || command.trim() === '') return 'Bash command is missing';
  const c = command.trim();
  const dangerousGit = /\bgit\s+(checkout|switch|reset|clean|rebase|merge|cherry-pick)\b|\bgit\s+push\b[^\n;&|]*--force(?:-with-lease)?\b|\bgit\s+branch\s+-[dD]\b/i;
  if (dangerousGit.test(c)) return 'branch/worktree/history mutation is blocked inside guarded worker sessions';

  const directMutator = /(^|[;&|]\s*|\s)(sed\s+-i\b|perl\s+-[^\s]*i[^\s]*\b|tee\b|touch\b|rm\b|mv\b|cp\b|truncate\b|install\b|patch\b|apply_patch\b)/i;
  if (directMutator.test(c)) return 'direct file mutation through Bash is blocked; use Edit/Write so lane and scope guards can inspect the target path';

  const redirect = /(^|[^<])(?:>>|>)(?![>&])/;
  if (redirect.test(c)) return 'file-output redirection through Bash is blocked in guarded worker sessions; use an inspected write path instead';

  const scriptedWrite = /\b(writeFileSync|writeFile|appendFileSync|appendFile|write_text|write_bytes)\b|\bopen\s*\([^\n]*,[^\n]*['\"](?:w|a|x)[+b]?['\"]/i;
  if (scriptedWrite.test(c)) return 'scripted file mutation through Bash is blocked; use Edit/Write so the authorized path can be checked';

  return null;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest must be an object');
  if (manifest.schema !== 'gpt-claude-hook-guard-v1') throw new Error('unsupported or missing manifest schema');
  if (!['worker-1', 'worker-2'].includes(manifest.worker)) throw new Error('manifest.worker must be worker-1 or worker-2');
  if (!manifest.session_anchor || typeof manifest.session_anchor !== 'object') throw new Error('manifest.session_anchor is required');
  if (!manifest.edit_scope || typeof manifest.edit_scope !== 'object') throw new Error('manifest.edit_scope is required');
  const allowedExact = manifest.edit_scope.allowed_exact || [];
  const allowedPrefixes = manifest.edit_scope.allowed_prefixes || [];
  evaluateScope({ changedPaths: [], allowedExact, allowedPrefixes });
  return manifest;
}

function sessionContext(anchor) {
  if (anchor.ok) {
    // Name any governed dirty path that was actually exercised: a silent pass cannot be told
    // apart from an exception that never fired.
    const excepted = (anchor.accepted_dirty || [])
      .map((entry) => `${entry.path} @ ${entry.diff_sha256.slice(0, 12)} (${entry.authority})`)
      .join('; ');
    return `GPT worker guard: anchor verified on ${anchor.branch} at ${anchor.head}.${excepted ? ` Governed dirty exception in force: ${excepted}.` : ''} Native edits remain subject to lane + authorized-scope enforcement.`;
  }
  return `GPT worker guard STOP: ${anchor.errors.join('; ')}. Do not edit. Resolve the exact worker branch/resume anchor first.`;
}

/**
 * 🛑 REMOVED: `persistAnchorOk(env.CLAUDE_ENV_FILE)`, which appended
 * `export TF_CLAUDE_GUARD_ANCHOR_OK=1` and was the only thing SessionStart did to arm the seat.
 *
 * MEASURED 2026-08-16 in the shipped claude.exe: `CLAUDE_ENV_FILE` is set in the hook child's
 * environment for SessionStart, Setup, CwdChanged and FileChanged ONLY, and its documented
 * purpose is to apply env to subsequent BASH TOOL commands. It is never turned into the
 * environment of a later hook subprocess. PreToolUse read `env.TF_CLAUDE_GUARD_ANCHOR_OK` from
 * its own process env, which nothing had ever set, so a correctly-launched seat was denied its
 * own first tool call. Two green tests covered the two ENDS of that handshake and none covered
 * the wire.
 *
 * The variable is not merely rerouted, it is DELETED. Writing it into the Bash tool's session
 * env would leave a bare, unbound "you are armed" constant lying around in a place a later
 * session can read — which is the fail-OPEN version of the same bug. Arming now goes through
 * guard-session-marker.mjs, where it is bound to session, worktree, git dir, branch, head and
 * toolbox pin, and where most of those facts are RE-MEASURED on every tool call rather than
 * remembered.
 */

function loadReceipt(repoRoot, receiptFile) {
  if (typeof receiptFile !== 'string' || receiptFile.trim() === '') throw new Error('finish.receipt_file is required');
  const absolute = path.isAbsolute(receiptFile) ? receiptFile : path.resolve(repoRoot, receiptFile);
  const rel = path.relative(repoRoot, absolute);
  if (rel === '..' || rel.startsWith(`..${path.sep}`)) throw new Error('finish.receipt_file escapes repository root');
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

/**
 * The single gate both post-start events go through. It answers one question — "is the thing I
 * am about to permit the same thing SessionStart actually proved?" — and it answers it from the
 * live tree, not from a remembered flag.
 */
function armedSession(input, manifest, repoRoot) {
  try {
    return verifyGuardSession({ repoRoot, sessionId: input.session_id, manifest });
  } catch (error) {
    // Fail closed and say why. A refusal whose reason is unreadable is how the previous defect
    // hid in plain sight for three seats.
    return { ok: false, reason: error.message };
  }
}

export function evaluateHookEvent({ input, manifest }) {
  validateManifest(manifest);
  if (!input || typeof input !== 'object') throw new Error('hook input must be an object');
  const cwd = input.cwd || process.cwd();
  const repoRoot = getRepoRoot(cwd);
  const event = input.hook_event_name;

  if (event === 'SessionStart') {
    const anchor = verifyResumeAnchor({
      cwd: repoRoot,
      expectedBranch: manifest.session_anchor.expected_branch,
      expectedHead: manifest.session_anchor.expected_head,
      requireClean: manifest.session_anchor.require_clean !== false,
      // AR-1265 §4: exact path + exact diff hash, never a blanket allow-dirty.
      allowedDirty: manifest.session_anchor.allowed_dirty || [],
    });
    let armed = null;
    let armError = null;
    try {
      if (anchor.ok) {
        armed = mintGuardSession({ repoRoot, sessionId: input.session_id, manifest, anchor }).marker;
      } else {
        // A refused SessionStart must also TAKE AWAY any marker a previous session left behind.
        // Otherwise the seat that failed its anchor check inherits the last one that passed —
        // an armed state nobody verified, which is the exact fail-OPEN shape being designed out.
        revokeGuardSession({ repoRoot, sessionId: input.session_id });
      }
    } catch (error) {
      // Could not mint => the seat is NOT armed. Say so in the context the operator reads, rather
      // than reporting "anchor verified" over a session that will deny its own first tool call.
      armError = error.message;
      try { revokeGuardSession({ repoRoot, sessionId: input.session_id }); } catch { /* already unarmed */ }
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        // 🛑 THIS STRING MUST NOT CONTAIN THE SUCCESS PHRASE. MEASURED 2026-08-16: an earlier
        // wording — "the resume anchor verified but the session could not be armed" — contained
        // the literal substring `anchor verified`, and the seat launcher's arm witness matches on
        // exactly that. The launcher printed `guard : ARMED` and `seat OK` while reading a STOP.
        // A refusal that contains the success phrase is a false GREEN in every downstream
        // detector, and the arm witness is the one gate standing between the operator and an
        // ungoverned seat. `A REFUSAL THAT SPELLS THE SUCCESS PHRASE IS A PASS.`
        additionalContext: armError
          ? `GPT worker guard STOP: the resume anchor check passed but this session could not be armed: ${armError}. Do not edit.`
          : sessionContext(anchor),
      },
      _audit: { event, anchor, armed: armed !== null, arm_error: armError },
    };
  }

  if (event === 'PreToolUse') {
    const session = armedSession(input, manifest, repoRoot);
    if (!session.ok) {
      return { ...deny(`worker session is not armed: ${session.reason}`), _audit: { event, anchor_verified: false, session } };
    }

    if (input.tool_name === 'Bash') {
      const command = input.tool_input?.command;
      // AR-1270 §B, on AR-1269 §5 (F-6). THE ORDER IS THE POINT: the protected-surface fence runs
      // FIRST, so a command touching the control plane is denied on the SURFACE it names, before
      // anything asks whether its writer's spelling happens to be one we recognise. Running the
      // blacklist first would leave the categorical hole exactly where AR-1269 found it.
      const fenced = bashProtectedSurfaceReason(command);
      if (fenced) {
        return { ...deny(fenced), _audit: { event, bash_protected_surface_blocked: true, bash_mutation_blocked: false } };
      }
      const reason = bashMutationReason(command);
      return reason
        ? { ...deny(reason), _audit: { event, bash_protected_surface_blocked: false, bash_mutation_blocked: true } }
        : { _audit: { event, bash_protected_surface_blocked: false, bash_mutation_blocked: false } };
    }

    // AR-1263 §7C: the G2-D one-shot boundary sits BEFORE the model call. A subagent
    // dispatch that touches G2 surface without a valid durable pre-call permit is refused
    // here, because post-call refusal cannot un-spend an attempt.
    // AR-1267 §6.2 scoping: the G2 artifacts are loaded ONLY for a subagent dispatch. Loading
    // them for every Edit/Write would make an unreadable G2 artifact deny ordinary lane work —
    // the same brick-the-seat shape as registering TaskCompleted against a receipt that does not
    // exist yet. Fail-closed must be aimed at the thing it protects.
    if (manifest.g2_precall && manifest.g2_precall.enabled === true
        && SUBAGENT_TOOL_NAMES.includes(input.tool_name)) {
      try {
        const g2 = loadG2Context({
          queuePath: path.resolve(repoRoot, manifest.g2_precall.queue_path),
          receiptDir: path.resolve(repoRoot, manifest.g2_precall.receipt_dir),
        });
        // AR-1267 §6.2: the frozen eight-row native-call identity. It is REQUIRED whenever the
        // pre-call gate is enabled — a missing path is a denial inside the guard, never a
        // silently unbound call, because "no expectation loaded" would otherwise be the widest
        // hole of all.
        const nativeCalls = loadNativeCallManifest({
          manifestPath: path.resolve(repoRoot, manifest.g2_precall.native_call_manifest_path),
        });
        const verdict = evaluateG2PreCall({
          toolName: input.tool_name,
          toolInput: input.tool_input,
          g2,
          nativeCalls,
          cwd: repoRoot,
          // AR-1265 §3.2: in the dedicated eight-call session, membership is decided by the
          // session rather than by the payload, so a G2 dispatch carrying only condition prose
          // cannot slip through as benign.
          strictSession: manifest.g2_precall.strict_session === true,
        });
        if (!verdict.allow) {
          return { ...deny(`G2 pre-call guard: ${verdict.reason}`), _audit: { event, g2: verdict } };
        }
        if (verdict.g2) return { _audit: { event, g2: verdict } };
      } catch (error) {
        // Fail closed: if the frozen artifacts cannot be read we cannot prove the budget.
        return { ...deny(`G2 pre-call guard could not verify the frozen budget: ${error.message}`), _audit: { event, g2_error: error.message } };
      }
    }

    if (!GUARDED_EDIT_TOOLS.has(input.tool_name)) return { _audit: { event, guarded: false } };

    let paths;
    try {
      paths = extractEditPaths(input, repoRoot);
    } catch (error) {
      return { ...deny(error.message), _audit: { event, path_error: error.message } };
    }

    const lane = auditPaths(manifest.worker, paths);
    const scope = evaluateScope({
      changedPaths: paths,
      allowedExact: manifest.edit_scope.allowed_exact || [],
      allowedPrefixes: manifest.edit_scope.allowed_prefixes || [],
    });
    // AR-1263 §7A precedence, evaluated by the single shared law.
    const decision = decideEditPermission(lane, scope);
    if (!decision.allow) {
      return { ...deny(`${decision.reason} [${paths.join(', ')}]`), _audit: { event, paths, lane, scope, decision } };
    }
    return { _audit: { event, paths, lane, scope, decision } };
  }

  if (event === 'TaskCompleted') {
    const session = armedSession(input, manifest, repoRoot);
    if (!session.ok) {
      return { ...block(`worker session is not armed: ${session.reason}; task completion is blocked`), _audit: { event, anchor_verified: false, session } };
    }
    if (!manifest.finish || manifest.finish.enabled !== true) {
      return { ...block('finish verification is not armed for this packet; task completion is fail-closed'), _audit: { event, finish_armed: false } };
    }
    try {
      const receipt = loadReceipt(repoRoot, manifest.finish.receipt_file);
      const result = runClaudeFinishCheck({
        cwd: repoRoot,
        worker: manifest.worker,
        base: manifest.finish.base,
        head: manifest.finish.head || 'HEAD',
        scope: manifest.edit_scope,
        receipt,
        otherWorkerRef: manifest.finish.other_worker_ref || null,
        collisionBase: manifest.finish.collision_base || null,
      });
      if (!result.ok) return { ...block(`mechanical finish check failed: ${result.failures.join('; ')}`), _audit: { event, finish: result } };
      return { _audit: { event, finish: result } };
    } catch (error) {
      return { ...block(`finish verification error: ${error.message}`), _audit: { event, finish_error: error.message } };
    }
  }

  return { _audit: { event, guarded: false } };
}

function visibleHookOutput(result) {
  const copy = { ...result };
  delete copy._audit;
  return copy;
}

function parseArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  try {
    const manifestPath = parseArg('--manifest');
    if (!manifestPath) throw new Error('--manifest is required');
    const inputText = fs.readFileSync(0, 'utf8');
    const input = JSON.parse(inputText);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const result = evaluateHookEvent({ input, manifest });
    const visible = visibleHookOutput(result);
    if (Object.keys(visible).length > 0) process.stdout.write(`${JSON.stringify(visible)}\n`);
  } catch (error) {
    const event = (() => {
      try { return JSON.parse(fs.readFileSync(0, 'utf8')).hook_event_name; } catch { return null; }
    })();
    if (event === 'PreToolUse') process.stdout.write(`${JSON.stringify(deny(`GPT worker guard internal error: ${error.message}`))}\n`);
    else if (event === 'TaskCompleted') process.stdout.write(`${JSON.stringify(block(`GPT worker guard internal error: ${error.message}`))}\n`);
    else process.stderr.write(`claude-hook-bridge: ${error.message}\n`);
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();
