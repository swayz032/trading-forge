#!/usr/bin/env node
/**
 * WORKER-1 NATIVE HOOK DOORWAY — AR-1266 §E/§F (on AR-1265 §5).
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A SECOND GUARD
 *   AR-1265 §5: "Do not build another guard implementation in Worker-1." The guard law lives in
 *   the pinned toolbox and nowhere else. But Claude's `settings.json` must name a command at a
 *   path that actually exists in THIS worktree, and the toolbox deliberately does not live here
 *   (`claude_toolbox.mjs`: copying it in "would be a rebuild with extra steps").
 *
 *   So this file carries NO boundary logic at all. It materializes the pinned toolbox and then
 *   EXECUTES THE PINNED `claude-hook-runner.mjs` as a child process, passing stdin through
 *   untouched. Not a reimplementation, not a wrapper around the law — a doorway to it.
 *   `A SECOND COPY OF A BOUNDARY RULE DRIFTS AND STOPS BITING WHILE STILL REPORTING PASS.`
 *
 * FAIL-CLOSED
 *   Every failure path here — bad pin, missing cache, child crash, non-zero exit with no output
 *   — denies. A guard doorway that fails OPEN is worse than no doorway, because the seat then
 *   believes it is protected. The one thing this must never do is let a tool call through
 *   because the guard itself was broken.
 *
 * Usage (from .claude/settings.json):
 *   node "$CLAUDE_PROJECT_DIR"/scripts/claude_guard_hook.mjs --manifest "$CLAUDE_PROJECT_DIR"/.claude/worker1-hook-guard-manifest.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { materialize } from './claude_toolbox.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Fail closed, in the shape the event expects. Silence would read as approval. */
function failClosed(event, reason) {
  if (event === 'PreToolUse') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Worker-1 guard doorway failed closed: ${reason}`,
      },
    });
  } else if (event === 'TaskCompleted') {
    emit({ decision: 'block', reason: `Worker-1 guard doorway failed closed: ${reason}` });
  } else if (event === 'SessionStart') {
    emit({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `GPT worker guard STOP: doorway failed closed: ${reason}. Guard was not armed; do not edit.`,
      },
    });
  } else {
    process.stderr.write(`claude_guard_hook: ${reason}\n`);
    process.exitCode = 2;
  }
}

/**
 * Materialize only when the cache does not already hold this exact pin. `materialize()` runs
 * one `git show` per toolbox file, and PreToolUse fires on every tool call under a 10s timeout —
 * re-extracting 40 files each time is how a guard becomes the thing people disable.
 * The stamp records the PIN, so a re-pin still forces a fresh extraction.
 */
function ensureToolbox() {
  const probe = materialize();
  const stampPath = path.join(probe.cache, '.pin-stamp');
  fs.writeFileSync(stampPath, `${probe.pin}\n${probe.bundle_sha256}\n`);
  return probe;
}

function cachedToolbox() {
  const cacheDir = path.join(process.env.TEMP || process.env.TMP || '/tmp', 'tf-claude-toolbox');
  const stampPath = path.join(cacheDir, '.pin-stamp');
  const runner = path.join(cacheDir, 'claude-hook-runner.mjs');
  if (fs.existsSync(stampPath) && fs.existsSync(runner)) {
    return { cache: cacheDir, runner, reused: true };
  }
  const receipt = ensureToolbox();
  return { cache: receipt.cache, runner: path.join(receipt.cache, 'claude-hook-runner.mjs'), reused: false };
}

let event = null;
try {
  const raw = fs.readFileSync(0, 'utf8');
  try { event = JSON.parse(raw).hook_event_name; } catch { event = null; }

  const manifestPath = arg('--manifest');
  if (!manifestPath) throw new Error('--manifest is required');
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);

  const { runner } = cachedToolbox();
  if (!fs.existsSync(runner)) throw new Error(`pinned claude-hook-runner.mjs not present at ${runner}`);

  const child = spawnSync(process.execPath, [runner, '--manifest', manifestPath], {
    input: raw,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (child.error) throw new Error(`pinned runner did not execute: ${child.error.message}`);

  const out = (child.stdout || '').trim();
  if (out) {
    process.stdout.write(`${out}\n`);
  } else if (child.status !== 0) {
    // A non-zero exit with nothing on stdout means the runner never rendered a decision.
    throw new Error(`pinned runner exited ${child.status} without a decision: ${(child.stderr || '').trim()}`);
  }
  // Empty stdout with exit 0 is the runner's own "no objection" contract; pass it through as-is.
} catch (error) {
  failClosed(event, error.message);
}
