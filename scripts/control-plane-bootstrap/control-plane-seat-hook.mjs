#!/usr/bin/env node
/**
 * AR-1277 §8 — THE CONTROL-PLANE SEAT'S HOOK DOORWAY.
 *
 * This is the file the FUTURE control-plane worktree's `.claude/settings.json` names for
 * SessionStart and PreToolUse. It is authored here, in ordinary Worker-1 scope, and materialized
 * into the privileged worktree only by an authorized bootstrap execution.
 *
 * ★ THE ENVELOPE SHAPE IS MEASURED, NOT GUESSED (AR-1276C §8 forbids guessing).
 * Read out of the pinned toolbox's `claude-hook-runner.mjs` @ b6c70282:
 *     PreToolUse deny -> { hookSpecificOutput: { hookEventName:'PreToolUse',
 *                          permissionDecision:'deny', permissionDecisionReason } }
 *     SessionStart    -> { hookSpecificOutput: { hookEventName:'SessionStart', additionalContext } }
 * and an internal error DENIES rather than falling through. That last property is copied
 * deliberately: a guard whose crash is an allow is not a guard.
 *
 * ★ FAIL-CLOSED ON EVERY UNKNOWN. Unknown tool, unreadable payload, missing manifest, identity
 * mismatch, absent allowlist — all deny. AR-1276C §5's whole complaint about the Worker-1 bridge
 * was that unknown tools fell through as `guarded:false`. This doorway has no fallthrough: the
 * final statement of the PreToolUse path is a denial.
 */

import fs from 'node:fs';
import { classifyControlPlanePath, classifyControlPlaneTool, verifySeatIdentity } from './control-plane-guard.mjs';

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `CONTROL-PLANE GUARD: ${reason}`,
    },
  };
}

function sessionContext(text) {
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

/** Tool inputs that carry a path the guard must classify. */
export function pathFromToolInput(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  if (['Edit', 'Write', 'NotebookEdit'].includes(toolName)) return toolInput.file_path ?? null;
  return null;
}

/**
 * Pure decision function — exported so tests exercise the real logic rather than a re-implementation.
 * @param input    the hook payload
 * @param manifest the control-plane manifest materialized into the privileged worktree
 * @param observed the seat identity measured at call time
 */
export function decide(input, manifest, observed) {
  const event = input?.hook_event_name;

  if (!manifest || typeof manifest !== 'object') {
    return event === 'PreToolUse'
      ? deny('no control-plane manifest — refusing every tool call')
      : sessionContext('CONTROL-PLANE GUARD NOT ARMED: manifest missing. Do not edit.');
  }

  const identity = verifySeatIdentity(observed, {
    actor: manifest.actor,
    branch: manifest.branch,
    worktree: manifest.worktree,
    targetPacket: manifest.target_packet,
    authorizationId: manifest.authorization_id,
    queueSha256: manifest.frozen_queue_sha256,
  });

  if (event === 'SessionStart') {
    if (!identity.ok) {
      return sessionContext(`CONTROL-PLANE GUARD NOT ARMED: ${identity.code} — ${identity.detail}. Do not edit.`);
    }
    // AR-1276C §8: "produce a start receipt before editing."
    return sessionContext(
      `CONTROL-PLANE SEAT ARMED: actor=${manifest.actor} packet=${manifest.target_packet} ` +
        `branch=${manifest.branch} authorization=${manifest.authorization_id} ` +
        `authorized_paths=${(manifest.allowed_paths || []).length}. ` +
        'Agent/Task/PowerShell are denied; every write outside the allowlist is denied.',
    );
  }

  if (event !== 'PreToolUse') {
    // Not this doorway's event. Emitting nothing is correct; emitting an allow is not.
    return null;
  }

  if (!identity.ok) return deny(`${identity.code} — ${identity.detail}`);

  const toolName = input?.tool_name;
  if (typeof toolName !== 'string' || toolName === '') return deny('unreadable tool name');

  const toolVerdict = classifyControlPlaneTool(toolName);
  if (toolVerdict.verdict !== 'ALLOW') return deny(toolVerdict.reason);

  const target = pathFromToolInput(toolName, input?.tool_input);
  if (target !== null) {
    const v = classifyControlPlanePath(target, manifest.allowed_paths);
    if (v.verdict !== 'ALLOW') return deny(`${v.verdict} ${v.path}: ${v.reason}`);
    return null; // allowed: say nothing, let the tool run
  }

  if (toolName === 'Bash') {
    const cmd = input?.tool_input?.command;
    if (typeof cmd !== 'string' || cmd.trim() === '') return deny('unreadable Bash command');
    const lower = cmd.replaceAll('\\', '/').toLowerCase();
    // Same reference-based fence the Worker-1 guard uses: deny if the command NAMES the frozen
    // plane at all, rather than trying to decide what the command would do to it.
    for (const token of ['isolated_fallback_queue_t1.json', 'isolated-receipts-t1', 'native_call_manifest_t1.json']) {
      if (lower.includes(token)) return deny(`Bash references the frozen G2 plane (${token})`);
    }
    return null;
  }

  // No fallthrough. An unrecognised tool on a privileged seat is denied, not permitted.
  return deny(`tool ${toolName} is not recognised by the control-plane guard — default deny`);
}

function main() {
  let input = null;
  try {
    const raw = fs.readFileSync(0, 'utf8');
    input = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (error) {
    process.stdout.write(`${JSON.stringify(deny(`unreadable hook payload: ${error.message}`))}\n`);
    return;
  }
  try {
    const i = process.argv.indexOf('--manifest');
    const manifestPath = i >= 0 ? process.argv[i + 1] : null;
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
    const observed = {
      actor: manifest?.actor,
      branch: manifest?.branch,
      worktree: manifest?.worktree,
      targetPacket: manifest?.target_packet,
      authorizationId: manifest?.authorization_id,
      queueSha256: manifest?.frozen_queue_sha256,
      isSubagent: false,
      ...(manifest?._observed_override || {}),
    };
    const out = decide(input, manifest, observed);
    if (out !== null) process.stdout.write(`${JSON.stringify(out)}\n`);
  } catch (error) {
    // Fail CLOSED, exactly as the pinned runner does.
    if (input?.hook_event_name === 'PreToolUse') {
      process.stdout.write(`${JSON.stringify(deny(`internal error: ${error.message}`))}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(sessionContext(`CONTROL-PLANE GUARD NOT ARMED: ${error.message}`))}\n`);
    }
  }
}

// Only run as a CLI, never on import (the tests import `decide` directly).
if (process.argv[1] && process.argv[1].endsWith('control-plane-seat-hook.mjs')) main();
