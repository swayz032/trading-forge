#!/usr/bin/env node
/**
 * NATIVE HOOK LIFECYCLE RED/GREEN CONTROLS — AR-1254 §10.
 *
 * Exercises the PINNED toolbox's real `claude-hook-runner.mjs` over the real Worker-1 manifest,
 * with real hook-event JSON on stdin — the same path Claude Code itself uses. It asserts both
 * directions: the guard must ALLOW in-scope work and DENY out-of-scope work. A guard proven only
 * to deny is indistinguishable from a broken one.
 *
 * 🛑 WHY THIS EXISTS AS A FILE INSTEAD OF A SHELL ONE-LINER. Both shells corrupted the probe
 * before it ever reached the guard, and both lied in the guard's voice:
 *   - Git Bash: node's `execFileSync('git', …)` returned `spawnSync git ENOENT`, so every event
 *     came back DENY. That reads exactly like "the guard denies everything".
 *   - PowerShell: the pipe prepended a UTF-8 BOM and the runner reported invalid JSON.
 * In both cases the guard was fine and the INSTRUMENT was broken. Spawning the runner from node
 * with an explicit stdin buffer removes both layers.
 *
 * usage: node scripts/worker1_hook_lifecycle_check.mjs [--manifest <path>]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const CACHE = path.join(os.tmpdir(), 'tf-claude-toolbox');
const RUNNER = path.join(CACHE, 'claude-hook-runner.mjs');
const REPO = process.cwd();

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const MANIFEST = arg('--manifest', '.claude/worker1-hook-guard-manifest.json');

/** Run one real hook event through the real runner, with an explicit env. */
function hook(event, extraEnv = {}) {
  const res = spawnSync(process.execPath, [RUNNER, '--manifest', MANIFEST], {
    cwd: REPO,
    input: Buffer.from(JSON.stringify(event), 'utf8'),   // no BOM, no shell quoting
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
  const out = (res.stdout || '').trim();
  let parsed = null;
  try { parsed = out ? JSON.parse(out) : null; } catch { /* leave null */ }
  return { raw: out, stderr: (res.stderr || '').trim(), json: parsed };
}

function decisionOf(r) {
  const d = r.json?.hookSpecificOutput?.permissionDecision;
  if (d) return d;
  if (r.json?.decision) return r.json.decision;
  if (r.json?.hookSpecificOutput?.hookEventName === 'SessionStart') return 'context';
  return r.raw ? 'unknown' : 'silent';
}

function reasonOf(r) {
  return (
    r.json?.hookSpecificOutput?.permissionDecisionReason ||
    r.json?.reason ||
    r.json?.hookSpecificOutput?.additionalContext ||
    ''
  );
}

// PRECONDITION: the instrument itself must work before any verdict it produces means anything.
try {
  execFileSync('git', ['--version'], { encoding: 'utf8' });
} catch (e) {
  console.error(
    'INSTRUMENT REFUSED: node cannot spawn `git` from this shell ' +
    `(${e.message}). Every hook verdict would come back DENY for that reason alone, which is ` +
    'indistinguishable from a guard that denies everything. Run from a shell where git is on ' +
    "node's PATH (PowerShell/cmd on this box) rather than trusting the output.",
  );
  process.exit(3);
}

/**
 * THE REAL LIFECYCLE, NOT A SHORTCUT. SessionStart appends `export TF_CLAUDE_GUARD_ANCHOR_OK=1`
 * to `$CLAUDE_ENV_FILE`; Claude Code sources that file so later hooks see the variable. PreToolUse
 * fails closed unless it does.
 *
 * 🛑 The probe therefore RUNS SessionStart FIRST and reads the flag back OUT OF THE FILE
 * SessionStart wrote. Setting the variable by hand would prove nothing — it would assert that the
 * guard allows edits when told the anchor is fine, which is the tautology, not the property. The
 * file is the positive witness that SessionStart actually verified.
 */
const envFile = path.join(os.tmpdir(), `tf-hook-env-${process.pid}`);
try { fs.rmSync(envFile, { force: true }); } catch { /* first run */ }

const sessionStart = hook({ hook_event_name: 'SessionStart', cwd: REPO },
                          { CLAUDE_ENV_FILE: envFile, TF_CLAUDE_GUARD_ANCHOR_OK: '' });
const envWritten = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const anchorOk = /TF_CLAUDE_GUARD_ANCHOR_OK=1/.test(envWritten);
const sessionEnv = anchorOk ? { TF_CLAUDE_GUARD_ANCHOR_OK: '1' } : { TF_CLAUDE_GUARD_ANCHOR_OK: '' };

const CASES = [
  {
    name: 'PreToolUse · in-scope edit',
    expect: 'allow',
    event: {
      hook_event_name: 'PreToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'src/engine/extraction/g2d_finalizer.py' }, cwd: REPO,
    },
  },
  {
    name: 'PreToolUse · out-of-scope edit (runtime/PAPER surface)',
    expect: 'deny',
    event: {
      hook_event_name: 'PreToolUse', tool_name: 'Edit',
      tool_input: { file_path: 'src/server/routes/paper.ts' }, cwd: REPO,
    },
  },
  {
    name: 'PreToolUse · destructive Bash',
    expect: 'deny',
    event: {
      hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'git reset --hard origin/main' }, cwd: REPO,
    },
  },
  {
    name: 'PreToolUse · benign Bash',
    expect: 'allow',
    event: {
      hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'git status --porcelain' }, cwd: REPO,
    },
  },
  { name: 'TaskCompleted', expect: 'any',
    event: { hook_event_name: 'TaskCompleted', cwd: REPO } },
];

const rows = CASES.map((c) => {
  const r = hook(c.event, sessionEnv);
  const decision = decisionOf(r);
  const ok =
    c.expect === 'any' ? true
      : c.expect === 'allow' ? decision !== 'deny' && decision !== 'block'
        : c.expect === 'deny' ? decision === 'deny' || decision === 'block'
          : decision === c.expect;
  return { case: c.name, expect: c.expect, decision, ok, reason: reasonOf(r).slice(0, 160) };
});

const internalErrors = rows.filter((r) => r.reason.includes('internal error'));
console.log(JSON.stringify({
  schema: 'worker1-native-hook-lifecycle-v1',
  authority: 'AR-1254 §10',
  manifest: MANIFEST,
  runner: RUNNER,
  session_start: {
    decision: decisionOf(sessionStart),
    reason: reasonOf(sessionStart).slice(0, 200),
    env_file_written_by_session_start: envWritten.trim() || '(nothing)',
    anchor_ok: anchorOk,
  },
  rows,
  discriminates: rows.some((r) => r.decision === 'deny') && rows.some((r) => r.expect === 'allow' && r.ok),
  internal_errors: internalErrors.length,
  verdict:
    internalErrors.length ? 'INSTRUMENT_ERROR — the guard never evaluated; do not read these as verdicts'
      : rows.every((r) => r.ok) ? 'BOTH_DIRECTIONS_PROVEN'
        : 'MISMATCH',
}, null, 2));

process.exit(internalErrors.length || rows.some((r) => !r.ok) ? 1 : 0);
