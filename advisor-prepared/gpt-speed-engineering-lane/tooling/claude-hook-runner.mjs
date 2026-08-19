#!/usr/bin/env node

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { evaluateHookEvent, bashMutationReason } from './claude-hook-bridge.mjs';
import { bashProtectedSurfaceReason } from './lane-boundary-guard.mjs';
import {
  authorizeIsolatedGraderDispatch,
  handleIsolatedGraderPreToolUse,
  isolatedGraderSessionStart,
} from './isolated-grader-seat.mjs';
import {
  revokeIssuedPermit,
  stampIsolatedGraderParentHistory,
  verifyActivationParentHistory,
  verifyActiveGraderParentHistory,
  verifyParentHistoryForDispatch,
} from './isolated-grader-parent-history.mjs';

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

function visible(result) {
  const copy = { ...result };
  delete copy._audit;
  return copy;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function emit(obj) {
  if (obj && Object.keys(obj).length > 0) process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function repoRootFor(input) {
  const cwd = input?.cwd || process.cwd();
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function explicitlyDenied(result) {
  return result?.hookSpecificOutput?.permissionDecision === 'deny' || result?.decision === 'block';
}

const ISOLATED_EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const ISOLATED_NESTED_AGENT_TOOLS = new Set(['Agent', 'Task']);

function isolatedActiveDecision(input, state) {
  if (ISOLATED_EDIT_TOOLS.has(input.tool_name)) {
    return {
      ...deny('isolated accuracy-validator is grader-only: Edit/Write/NotebookEdit are denied'),
      _audit: { event: 'PreToolUse', isolated_grader: state.session, edit_denied: true },
    };
  }
  if (ISOLATED_NESTED_AGENT_TOOLS.has(input.tool_name)) {
    return {
      ...deny('isolated accuracy-validator cannot dispatch nested Agent/Task calls'),
      _audit: { event: 'PreToolUse', isolated_grader: state.session, nested_agent_denied: true },
    };
  }
  if (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') {
    const command = input.tool_input?.command;
    // Preserve the same protected-surface and mutation fences as the normal Worker seat. The
    // isolated grader gains execution, not a side door around the guard's Bash law.
    const fenced = bashProtectedSurfaceReason(command);
    if (fenced) {
      return {
        ...deny(fenced),
        _audit: { event: 'PreToolUse', isolated_grader: state.session, bash_protected_surface_blocked: true },
      };
    }
    const mutation = bashMutationReason(command);
    if (mutation) {
      return {
        ...deny(mutation),
        _audit: { event: 'PreToolUse', isolated_grader: state.session, bash_mutation_blocked: true },
      };
    }
    return { _audit: { event: 'PreToolUse', isolated_grader: state.session, execution_allowed: true } };
  }
  return { _audit: { event: 'PreToolUse', isolated_grader: state.session, guarded: false } };
}

let input = null;
try {
  const raw = fs.readFileSync(0, 'utf8');
  input = JSON.parse(raw);
  const manifestPath = arg('--manifest');
  if (!manifestPath) throw new Error('--manifest is required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const repoRoot = repoRootFor(input);

  let result = null;

  // Synthetic Agent worktrees intentionally do NOT inherit the normal Worker branch anchor. A
  // pending SessionStart only explains the redemption protocol; it does not arm anything.
  if (input.hook_event_name === 'SessionStart') {
    result = isolatedGraderSessionStart({ input, manifest, repoRoot });
    if (!result) {
      result = evaluateHookEvent({ input, manifest });
      // A successful NORMAL Worker SessionStart gets an isolated-grader-only history baseline in
      // the already self-protected armed marker. Failure to stamp it does not brick ordinary
      // Worker execution; it simply makes future isolated-grader permits fail closed.
      if (result?._audit?.anchor?.ok && result?._audit?.armed) {
        try {
          const baseline = stampIsolatedGraderParentHistory({
            repoRoot,
            sessionId: input.session_id,
            manifest,
          });
          result._audit.isolated_grader_parent_history = baseline;
        } catch (error) {
          result._audit.isolated_grader_parent_history_error = error.message;
        }
      }
    }
  } else if (input.hook_event_name === 'PreToolUse') {
    // A token is useless if its parent loses authority between mint and redemption. Check the
    // parent history BEFORE the child-side handler can atomically consume the permit.
    const activationParent = verifyActivationParentHistory({ input, manifest, repoRoot });
    if (activationParent.applicable && !activationParent.ok) {
      result = {
        ...deny(`isolated grader activation refused: ${activationParent.reason}`),
        _audit: { event: 'PreToolUse', isolated_grader_activation_parent: activationParent },
      };
    } else {
      // Child side first. An unarmed worktree-agent-* can do exactly one special thing: redeem
      // the secret one-use activation token injected into its prompt.
      const isolated = handleIsolatedGraderPreToolUse({ input, manifest, repoRoot });
      if (isolated?.handled) {
        if (isolated.active) {
          // Parent authority remains load-bearing AFTER activation too. Any later reset/rebase of
          // the parent revokes execution on the next child command.
          const parentHistory = verifyActiveGraderParentHistory({
            isolatedSession: isolated.session,
            manifest,
          });
          result = parentHistory.ok
            ? isolatedActiveDecision(input, isolated)
            : {
                ...deny(`isolated grader parent authority invalidated: ${parentHistory.reason}`),
                _audit: { event: 'PreToolUse', isolated_grader: isolated.session, parent_history: parentHistory },
              };
        } else {
          result = isolated.result;
        }
      } else {
        // Parent side. Run the normal guard FIRST. An explicit normal-guard denial always wins.
        const base = evaluateHookEvent({ input, manifest });
        if (explicitlyDenied(base)) {
          result = base;
        } else {
          // AR-1358 A2: current-state arming alone cannot distinguish H1->H2->reset-H1 from a
          // session that never moved. The reflog baseline must prove monotonic history before a
          // token can be minted.
          const historyBefore = verifyParentHistoryForDispatch({ input, manifest, repoRoot });
          if (historyBefore.applicable && !historyBefore.ok) {
            result = {
              ...deny(`isolated grader permit refused: ${historyBefore.reason}`),
              _audit: { event: 'PreToolUse', isolated_grader_parent_history: historyBefore },
            };
          } else {
            const issued = authorizeIsolatedGraderDispatch({
              input,
              manifest,
              repoRoot,
              baseResult: base,
            });
            if (!issued) {
              result = base;
            } else {
              // Close the mint-time TOCTOU window: re-check after the permit file exists but
              // BEFORE its plaintext token/prompt is emitted. On failure, delete the unconsumed
              // permit and return a denial.
              const historyAfter = verifyParentHistoryForDispatch({ input, manifest, repoRoot });
              if (!historyAfter.ok) {
                revokeIssuedPermit({ result: issued, repoRoot });
                result = {
                  ...deny(`isolated grader permit revoked before dispatch: ${historyAfter.reason}`),
                  _audit: { event: 'PreToolUse', isolated_grader_parent_history: historyAfter },
                };
              } else {
                result = issued;
              }
            }
          }
        }
      }
    }
  } else {
    result = evaluateHookEvent({ input, manifest });
  }

  emit(visible(result));
} catch (error) {
  const reason = `GPT worker guard internal error: ${error.message}`;
  if (input?.hook_event_name === 'PreToolUse') emit(deny(reason));
  else if (input?.hook_event_name === 'TaskCompleted' || input?.hook_event_name === 'PostToolUse') emit(block(reason));
  else if (input?.hook_event_name === 'SessionStart') {
    emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `${reason}. Guard was not armed; do not edit.` } });
  } else {
    process.stderr.write(`${reason}\n`);
    process.exitCode = 2;
  }
}
