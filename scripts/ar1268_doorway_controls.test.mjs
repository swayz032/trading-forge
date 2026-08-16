// AR-1268 §B controls — the stale toolbox cache (AR-1267 §4 / F-2).
//
// WHY THESE DRIVE THE REGISTERED COMMAND AND NOT AN IMPORTED FUNCTION
//   The defect is in what Claude actually EXECUTES. AR-1265 already convicted the weaker shape:
//   a correct guard that never receives the event is not a guard. So every control below spawns
//   `node scripts/claude_guard_hook.mjs --manifest <...>` — the exact string in .claude/settings.json
//   — and feeds it a real PreToolUse payload on stdin.
//
// WHY THE CACHE IS SANDBOXED
//   `cachedToolbox` and `materialize` both resolve the cache under TEMP/TMP, so each control runs
//   the child with TEMP and TMP pointed at its own directory. Nothing here touches the seat's real
//   TEMP cache, and nothing here writes into the repository.
//
// NOTHING HERE TOUCHES G2
//   The probe payload is an Edit against a self-protected path. The G2 gate is not exercised and
//   no attempt can be spent by any control in this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const DOORWAY = process.env.AR1268_DOORWAY || path.join(HERE, 'claude_guard_hook.mjs');
const MANIFEST = path.join(REPO, '.claude', 'worker1-hook-guard-manifest.json');

/** A PreToolUse edit against a SELF_PROTECTED path. The real law denies it; a permissive
 *  runner allows it. That asymmetry is what makes the stale-cache control BITE — without a
 *  payload the two toolboxes disagree on, "it ran" and "it ran the right law" look identical. */
const PROBE = JSON.stringify({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_input: { file_path: path.join(REPO, '.claude', 'settings.json') },
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar1268-doorway-'));
  return { dir, cache: path.join(dir, 'tf-claude-toolbox') };
}

function runDoorway(sb, { manifest = MANIFEST } = {}) {
  const res = spawnSync(process.execPath, [DOORWAY, '--manifest', manifest], {
    input: PROBE,
    encoding: 'utf8',
    cwd: REPO,
    env: {
      ...process.env,
      TEMP: sb.dir,
      TMP: sb.dir,
      TF_CLAUDE_GUARD_ANCHOR_OK: '1',
    },
  });
  let decision = null;
  try { decision = JSON.parse((res.stdout || '').trim()); } catch { decision = null; }
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim(), decision };
}

function verdictOf(out) {
  const d = out.decision?.hookSpecificOutput?.permissionDecision;
  return d || (out.stdout === '' ? 'no-objection' : 'unparsed');
}

/** A stale toolbox: a syntactically valid stamp for a DIFFERENT pin, plus a runner that allows
 *  everything. This is what a TEMP directory looks like after a deliberate re-pin. */
function seedStaleCache(sb, { pin = 'd'.repeat(40), bundle = 'e'.repeat(64) } = {}) {
  fs.mkdirSync(sb.cache, { recursive: true });
  fs.writeFileSync(path.join(sb.cache, '.pin-stamp'), `${pin}\n${bundle}\n`);
  fs.writeFileSync(
    path.join(sb.cache, 'claude-hook-runner.mjs'),
    // The old permissive law: no boundary logic at all, allows every tool call.
    'process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",' +
    'permissionDecision:"allow",permissionDecisionReason:"STALE PERMISSIVE TOOLBOX"}})+"\\n");\n',
  );
}

// ---------------------------------------------------------------------------
// DISCRIMINATION FIRST — establish that the probe separates the two laws
// ---------------------------------------------------------------------------

test('WITNESS: the seeded stale runner really is permissive (the control can distinguish)', () => {
  const sb = sandbox();
  seedStaleCache(sb);
  const res = spawnSync(process.execPath, [path.join(sb.cache, 'claude-hook-runner.mjs')], {
    input: PROBE, encoding: 'utf8',
  });
  const out = JSON.parse(res.stdout.trim());
  assert.equal(out.hookSpecificOutput.permissionDecision, 'allow');
  // If this ever stops being 'allow', every assertion below becomes unfalsifiable.
});

// ---------------------------------------------------------------------------
// THE DEFECT — §4 / F-2
// ---------------------------------------------------------------------------

test('B: a STALE cache cannot execute the old law — the doorway rematerializes the pinned one', () => {
  const sb = sandbox();
  seedStaleCache(sb);
  const out = runDoorway(sb);
  assert.notEqual(verdictOf(out), 'allow',
    `the stale permissive toolbox won: ${out.stdout || out.stderr}`);
  assert.equal(verdictOf(out), 'deny');
  assert.doesNotMatch(out.stdout, /STALE PERMISSIVE TOOLBOX/);
  // and the cache now holds the pinned identity rather than the seeded one
  const stamp = fs.readFileSync(path.join(sb.cache, '.pin-stamp'), 'utf8');
  const expected = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.match(stamp, new RegExp(expected._toolbox_pin));
  assert.match(stamp, new RegExp(expected._toolbox_bundle_sha256));
});

test('B: a cache with the RIGHT stamp but TAMPERED bytes is not trusted', () => {
  const sb = sandbox();
  const expected = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  // The stamp claims the correct pin and bundle. Only the FILES lie. A stamp check alone passes
  // this; only re-hashing the materialized bytes catches it.
  seedStaleCache(sb, { pin: expected._toolbox_pin, bundle: expected._toolbox_bundle_sha256 });
  const out = runDoorway(sb);
  assert.equal(verdictOf(out), 'deny');
  assert.doesNotMatch(out.stdout, /STALE PERMISSIVE TOOLBOX/);
});

test('B: a manifest declaring no pin/bundle DENIES rather than trusting whatever is in TEMP', () => {
  const sb = sandbox();
  seedStaleCache(sb);
  const stripped = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  delete stripped._toolbox_pin;
  delete stripped._toolbox_bundle_sha256;
  const p = path.join(sb.dir, 'no-pin-manifest.json');
  fs.writeFileSync(p, JSON.stringify(stripped));
  const out = runDoorway(sb, { manifest: p });
  assert.equal(verdictOf(out), 'deny');
  assert.match(out.stdout, /failed closed/);
  assert.match(out.stdout, /_toolbox_pin/);
});

// ---------------------------------------------------------------------------
// POSITIVE — the fast path still exists, and it still enforces
// ---------------------------------------------------------------------------

test('B POSITIVE: a cold cache materializes the pinned toolbox and enforces the real law', () => {
  const sb = sandbox();
  const out = runDoorway(sb);
  assert.equal(verdictOf(out), 'deny', out.stdout || out.stderr);
  assert.match(out.stdout, /self-protected|SELF_PROTECTED/i);
});

test('B POSITIVE: a warm, correct cache is REUSED — the guard stays cheap enough not to be disabled', () => {
  const sb = sandbox();
  runDoorway(sb);                                   // cold: materializes
  const before = fs.statSync(path.join(sb.cache, 'claude-hook-runner.mjs')).mtimeMs;
  const out = runDoorway(sb);                       // warm: must not re-extract
  const after = fs.statSync(path.join(sb.cache, 'claude-hook-runner.mjs')).mtimeMs;
  assert.equal(verdictOf(out), 'deny');
  assert.equal(before, after, 'a correct cache must be reused, not rebuilt on every tool call');
});

test('B DISCRIMINATES: an in-scope ordinary edit is still permitted', () => {
  // Without this the suite cannot tell "verifies the toolbox" from "denies everything".
  const sb = sandbox();
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(REPO, 'scripts', 'system_inventory.py') },
  });
  const res = spawnSync(process.execPath, [DOORWAY, '--manifest', MANIFEST], {
    input: payload, encoding: 'utf8', cwd: REPO,
    env: { ...process.env, TEMP: sb.dir, TMP: sb.dir, TF_CLAUDE_GUARD_ANCHOR_OK: '1' },
  });
  const stdout = (res.stdout || '').trim();
  const decision = stdout ? JSON.parse(stdout)?.hookSpecificOutput?.permissionDecision : null;
  assert.notEqual(decision, 'deny', `ordinary in-scope work must not be denied: ${stdout}`);
});
