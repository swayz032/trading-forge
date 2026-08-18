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
import crypto from 'node:crypto';
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

/**
 * 🛑 AR-1267 §4 (F-2) — THE CACHE DID NOT VERIFY THE PIN IT CLAIMED TO CACHE.
 *
 * The comment above always said "only when the cache does not already hold this exact pin", but
 * the code checked two things that are true of ANY previous materialization:
 *
 *     .pin-stamp exists  &&  claude-hook-runner.mjs exists   ->  reuse
 *
 * It never READ the stamp. So after a deliberate re-pin, an older permissive runner left in TEMP
 * kept winning: GitHub and the manifest said NEW LAW, the process executed OLD LAW, and every
 * receipt in sight agreed with the manifest. That is a silent guard downgrade — the worst shape
 * this desk knows, because nothing anywhere reports a disagreement.
 *
 * `A CACHE KEYED ON EXISTENCE IS NOT A CACHE OF ANYTHING IN PARTICULAR.`
 *
 * The expected identity is the MANIFEST's, not this file's: the manifest is self-protected and
 * declares what the seat activated, while a constant here is one more thing a re-pin can forget.
 * Verified before the child runs, in this order, and any failure rematerializes or DENIES —
 * never a silent reuse:
 *
 *   1. read the cached stamp;         2. exact-match expected pin;
 *   3. exact-match expected bundle;   4. re-hash the cached FILES back to that bundle;
 *   5. after rematerialization, require the returned pin + bundle to equal the manifest;
 *   6. any mismatch or failure -> DENY.
 *
 * Step 4 is local hashing of ~40 small files, not 40 `git show` calls, so the fast path stays
 * fast (AR-1267 §4: "Do not solve this by materializing 40 Git objects on every tool call").
 */
function bundleShaOfCache(cacheDir) {
  const names = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.mjs')).sort();
  if (names.length === 0) return null;
  const rows = names.map((name) => {
    const body = fs.readFileSync(path.join(cacheDir, name), 'utf8');
    return `${name}:${crypto.createHash('sha256').update(body, 'utf8').digest('hex')}`;
  });
  return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
}

function cachedToolbox(expected) {
  if (!expected || !expected.pin || !expected.bundle) {
    throw new Error(
      'the guard manifest declares no _toolbox_pin/_toolbox_bundle_sha256, so the cached toolbox ' +
      'identity cannot be verified; refusing rather than trusting whatever is in TEMP',
    );
  }
  const cacheDir = path.join(process.env.TEMP || process.env.TMP || '/tmp', 'tf-claude-toolbox');
  const stampPath = path.join(cacheDir, '.pin-stamp');
  const runner = path.join(cacheDir, 'claude-hook-runner.mjs');

  if (fs.existsSync(stampPath) && fs.existsSync(runner)) {
    const [pin, bundle] = fs.readFileSync(stampPath, 'utf8').split('\n').map((s) => s.trim());
    if (pin === expected.pin && bundle === expected.bundle && bundleShaOfCache(cacheDir) === expected.bundle) {
      return { cache: cacheDir, runner, reused: true };
    }
    // Stale, tampered, or from another pin. Fall through and rematerialize from the pinned
    // commit; the post-check below is what decides whether the result may be executed.
  }

  const receipt = ensureToolbox();
  if (receipt.pin !== expected.pin) {
    throw new Error(`materialized toolbox pin ${receipt.pin} != manifest _toolbox_pin ${expected.pin}`);
  }
  if (receipt.bundle_sha256 !== expected.bundle) {
    throw new Error(
      `materialized toolbox bundle ${receipt.bundle_sha256} != manifest _toolbox_bundle_sha256 ` +
      `${expected.bundle}; the pinned commit does not contain the reviewed toolbox`,
    );
  }
  return { cache: receipt.cache, runner: path.join(receipt.cache, 'claude-hook-runner.mjs'), reused: false };
}

let event = null;
try {
  const raw = fs.readFileSync(0, 'utf8');
  try { event = JSON.parse(raw).hook_event_name; } catch { event = null; }

  const manifestPath = arg('--manifest');
  if (!manifestPath) throw new Error('--manifest is required');
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);

  // AR-1267 §4: the MANIFEST is the expected identity. It is self-protected, so the worker
  // cannot move the target it is measured against.
  const manifestDoc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { runner } = cachedToolbox({
    pin: manifestDoc._toolbox_pin,
    bundle: manifestDoc._toolbox_bundle_sha256,
  });
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
