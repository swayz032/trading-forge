/**
 * THE WIRE BETWEEN THE TWO HALVES OF THE GUARD HANDSHAKE.
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM claude-hook-bridge.test.mjs
 *   The bridge suite tested BOTH ENDS of the SessionStart -> PreToolUse handshake and never once
 *   tested the wire between them:
 *
 *     producer side : read the file SessionStart wrote and assert the marker text is in it.
 *     consumer side : hand PreToolUse a hand-built `env` object containing the marker.
 *
 *   Both were green. Both were half. The consumer never read what the producer wrote, so the
 *   suite could not see that the producer wrote to `CLAUDE_ENV_FILE` while the consumer read
 *   `process.env` -- two different places.
 *
 *   MEASURED 2026-08-16 in the shipped claude.exe: `CLAUDE_ENV_FILE` is placed in the hook
 *   environment for SessionStart, Setup, CwdChanged and FileChanged ONLY, and its documented
 *   purpose is "write bash exports there to apply env to subsequent BashTool commands." It is
 *   never applied to a later hook subprocess. So the armed marker could not reach PreToolUse by
 *   any route, and a correctly-launched Worker-1 seat denied its own first tool call.
 *
 *   `TWO GREEN HALF-HANDSHAKES ARE NOT A HANDSHAKE.`
 *
 * WHAT THIS FILE MAY NOT DO
 *   It may not construct an `env` for the guard, may not call `evaluateHookEvent` in-process, and
 *   may not write the marker itself. Every test below spawns the REAL runner as a REAL child
 *   process, exactly as scripts/claude_guard_hook.mjs does, lets it EXIT, and then spawns a
 *   SECOND real process. Anything the second process knows, it learned across a process boundary
 *   that actually exists in production.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { guardSessionMarkerPath } from './claude-hook-bridge.mjs';

const RUNNER = path.join(import.meta.dirname, 'claude-hook-runner.mjs');

const PIN = '18108039056a0994c1fc1be9583812b0838dba50';
const BUNDLE = '1d12f61277d8d3c502df9bd7dea5dac541e64335e469fd7176187f4b02144b06';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo(slug) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `claude-lifecycle-${slug}-`)));
  git(root, 'init');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'src/server/compiler'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/server/services'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'base\n');
  fs.writeFileSync(path.join(root, 'src/server/services/paper-engine.ts'), 'base\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  git(root, 'branch', '-M', 'worker-one');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}

function writeManifest(root, overrides = {}) {
  // Outside the work tree on purpose: a manifest committed into the fixture would be one more
  // thing require_clean has an opinion about, and re-pin tests need to rewrite it freely.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lifecycle-manifest-')), 'manifest.json');
  fs.writeFileSync(file, JSON.stringify({
    schema: 'gpt-claude-hook-guard-v1',
    worker: 'worker-1',
    _toolbox_pin: PIN,
    _toolbox_bundle_sha256: BUNDLE,
    session_anchor: {
      expected_branch: 'worker-one',
      // A REF, matching the live Worker-1 manifest: a pinned SHA would go stale the moment the
      // worker commits, and a guard that is stale by design gets disabled by whoever it annoys.
      expected_head: 'worker-one',
      require_clean: true,
    },
    edit_scope: { allowed_exact: ['src/server/compiler/lower.ts'], allowed_prefixes: [] },
    finish: { enabled: false },
    ...overrides,
  }, null, 2));
  return file;
}

/**
 * A hook environment as Claude Code actually builds it -- and, critically, WITHOUT the two
 * variables a fabricated test env would smuggle in. If the guard needs either of these to arm,
 * these tests must fail, because production never supplies them to PreToolUse.
 */
function hookEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.TF_CLAUDE_GUARD_ANCHOR_OK;
  if (!('CLAUDE_ENV_FILE' in extra)) delete env.CLAUDE_ENV_FILE;
  return env;
}

function runHook(cwd, manifestPath, payload, extraEnv = {}) {
  const child = spawnSync(process.execPath, [RUNNER, '--manifest', manifestPath], {
    cwd,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: hookEnv(extraEnv),
  });
  if (child.error) throw child.error;
  const stdout = (child.stdout || '').trim();
  return {
    status: child.status,
    stdout,
    stderr: (child.stderr || '').trim(),
    json: stdout ? JSON.parse(stdout) : null,
  };
}

/** Runs a REAL SessionStart process against a REAL CLAUDE_ENV_FILE, then lets it exit. */
function sessionStart(root, manifestPath, sessionId = 's1') {
  const envFile = path.join(root, '.git', 'claude-env');
  const result = runHook(
    root,
    manifestPath,
    { cwd: root, hook_event_name: 'SessionStart', source: 'startup', session_id: sessionId },
    { CLAUDE_ENV_FILE: envFile },
  );
  return { ...result, envFile };
}

function preToolUse(root, manifestPath, sessionId, tool_name, tool_input) {
  return runHook(root, manifestPath, {
    cwd: root, hook_event_name: 'PreToolUse', tool_name, tool_input, session_id: sessionId,
  });
}

function decision(result) {
  return result.json?.hookSpecificOutput?.permissionDecision ?? null;
}
function reason(result) {
  return result.json?.hookSpecificOutput?.permissionDecisionReason ?? '';
}
function editOwned(root) {
  return [{ file_path: path.join(root, 'src/server/compiler/lower.ts'), old_string: 'base', new_string: 'x' }];
}

// ---------------------------------------------------------------------------------------------
// THE WIRE
// ---------------------------------------------------------------------------------------------

test('a real SessionStart process arms a real PreToolUse process with nothing injected', () => {
  const { root } = makeRepo('wire');
  const manifestPath = writeManifest(root);

  const start = sessionStart(root, manifestPath);
  assert.match(start.json.hookSpecificOutput.additionalContext, /anchor verified/, start.stderr);

  // Separate process. No TF_CLAUDE_GUARD_ANCHOR_OK, no CLAUDE_ENV_FILE -- production supplies
  // neither to PreToolUse, which is the entire defect this test exists to convict.
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), null, `guard denied an armed seat: ${reason(gate)}`);
  assert.equal(gate.stdout, '', 'an allowed call must emit the runner\'s empty no-objection output');
  assert.equal(gate.status, 0);
});

test('an armed session still enforces scope -- arming is not a blanket allow', () => {
  const { root } = makeRepo('scope');
  const manifestPath = writeManifest(root);
  assert.match(sessionStart(root, manifestPath).json.hookSpecificOutput.additionalContext, /anchor verified/);

  // Positive witness that the armed path is genuinely evaluating and not short-circuiting:
  // the SAME armed session must still refuse a cross-lane target.
  const blocked = preToolUse(root, manifestPath, 's1', 'Write', {
    file_path: path.join(root, 'src/server/services/paper-engine.ts'), content: 'x',
  });
  assert.equal(decision(blocked), 'deny');
  assert.match(reason(blocked), /not scope-overridable/);
});

test('an armed session cannot write its own marker through Edit or Bash', () => {
  const { root } = makeRepo('selfprotect');
  const manifestPath = writeManifest(root, {
    // A scope that DOES cover the marker's directory. A boundary that only holds because the
    // packet scope happens to be narrow is a property of the packet, not of the boundary — and
    // "a broader prefix in some future manifest" is how AR-1269 §4 found the receipt gap.
    edit_scope: { allowed_exact: [], allowed_prefixes: ['src/', 'scripts/', '.git/'] },
  });
  sessionStart(root, manifestPath, 's1');

  const forged = preToolUse(root, manifestPath, 's1', 'Write', {
    file_path: guardSessionMarkerPath(root, 's1'), content: '{}',
  });
  assert.equal(decision(forged), 'deny');
  // Must be refused ON THE SURFACE, not on scope — otherwise this control passes on the manifest
  // rather than on the boundary, and would go quiet the day someone widens a prefix.
  assert.match(reason(forged), /self-protected/i);

  const viaBash = preToolUse(root, manifestPath, 's1', 'Bash', {
    command: 'cat < tf-claude-guard-session-s1.json',
  });
  assert.equal(decision(viaBash), 'deny');
  assert.match(reason(viaBash), /protected-surface fence/);
});

// ---------------------------------------------------------------------------------------------
// THE MARKER IS BOUND -- every one of these must DENY
// ---------------------------------------------------------------------------------------------

test('PreToolUse denies when no SessionStart process ever ran', () => {
  const { root } = makeRepo('nostart');
  const manifestPath = writeManifest(root);
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /no armed guard session/i);
});

test('PreToolUse denies a tool call carrying a different session id', () => {
  const { root } = makeRepo('othersession');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  const gate = preToolUse(root, manifestPath, 's2', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /no armed guard session/i);
});

test('PreToolUse denies a marker copied onto another session id', () => {
  const { root } = makeRepo('markermove');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  // The interesting failure is not a MISSING marker, it is a marker that EXISTS at the path the
  // guard will look at and belongs to somebody else.
  fs.copyFileSync(guardSessionMarkerPath(root, 's1'), guardSessionMarkerPath(root, 's2'));
  const gate = preToolUse(root, manifestPath, 's2', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /session/i);
});

test('PreToolUse denies a marker minted in a different worktree', () => {
  const a = makeRepo('wt-a');
  const b = makeRepo('wt-b');
  const manifestA = writeManifest(a.root);
  const manifestB = writeManifest(b.root);
  sessionStart(a.root, manifestA, 's1');

  // The fail-OPEN shape the design must refuse: an armed marker carried into a tree it was never
  // verified against. Same session id, same branch name, same file layout -- different worktree.
  fs.copyFileSync(guardSessionMarkerPath(a.root, 's1'), guardSessionMarkerPath(b.root, 's1'));
  const gate = preToolUse(b.root, manifestB, 's1', 'Edit', ...editOwned(b.root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /worktree|git directory/i);
});

/**
 * FIELD-LEVEL DISCRIMINATORS.
 *
 * The cross-worktree fixture above trips SEVERAL bindings at once — a marker carried into
 * another checkout has the wrong worktree AND the wrong git dir AND arrives in a tree whose
 * anchor differs. That is the realistic attack but it is a poor control: MEASURED here by
 * mutation sweep, removing either the worktree check or the git-dir check on its own left that
 * test GREEN, because the other one caught it.
 *
 * `A CONTROL THAT PASSES BECAUSE ITS NEIGHBOUR FIRED IS NOT A CONTROL FOR ITSELF.`
 *
 * So each field gets a fixture that trips it and nothing else.
 */
function tamper(root, sessionId, patch) {
  const file = guardSessionMarkerPath(root, sessionId);
  const marker = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...marker, ...patch }, null, 2));
}

test('PreToolUse denies a marker whose worktree field alone is wrong', () => {
  const { root } = makeRepo('field-worktree');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  tamper(root, 's1', { worktree: path.join(path.dirname(root), 'somewhere-else') });
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /minted in worktree/);
});

test('PreToolUse denies a marker whose git directory field alone is wrong', () => {
  const { root } = makeRepo('field-gitdir');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  tamper(root, 's1', { git_dir: path.join(path.dirname(root), 'elsewhere', '.git') });
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /git directory/);
});

test('PreToolUse denies a marker whose recorded branch alone disagrees with the manifest', () => {
  const { root } = makeRepo('field-branch');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  // The live branch is still correct here, so only the marker's own claim is wrong. This is the
  // "the marker says it proved something it did not prove" case.
  tamper(root, 's1', { branch: 'some-other-branch' });
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /minted on branch/);
});

test('PreToolUse denies after HEAD is rewound below the armed anchor', () => {
  const { root } = makeRepo('stalehead');
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'second\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'second');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  git(root, 'reset', '--hard', 'HEAD~1');
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /head|anchor/i);
});

test('PreToolUse denies after the branch is switched out from under the armed session', () => {
  const { root } = makeRepo('branchswap');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  git(root, 'checkout', '-b', 'somewhere-else');
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /branch/i);
});

test('PreToolUse denies on a detached HEAD', () => {
  const { root } = makeRepo('detached');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  // The batched `git rev-parse ... --abbrev-ref HEAD` prints the literal string "HEAD" when the
  // checkout is detached. Nothing in the code path distinguishes that from a branch NAME except
  // one comparison, so it gets its own control.
  git(root, 'checkout', '--detach');
  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /\(detached\)/);
});

test('PreToolUse denies when the toolbox is re-pinned under a live session', () => {
  const { root } = makeRepo('repin');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  // A re-pin is a deliberate change of law. A session armed under the OLD law must not keep
  // running under the new one on the strength of a marker minted before the change.
  const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  doc._toolbox_pin = 'deadbeef000000000000000000000000deadbeef';
  fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2));

  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /pin|toolbox/i);
});

test('PreToolUse denies when the toolbox bundle changes under an unchanged pin', () => {
  const { root } = makeRepo('rebundle');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  // Same pin, different bundle. This is the silent-downgrade shape AR-1267 §4 convicted: every
  // artifact in sight agrees with the manifest while the executing law is somebody else's.
  const doc = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  doc._toolbox_bundle_sha256 = '0'.repeat(64);
  fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2));

  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /bundle/);
});

test('PreToolUse denies a commit that leaves a SHA-pinned anchor behind', () => {
  const { root, base } = makeRepo('pinnedhead');
  // expected_head as a literal SHA rather than a ref. The live Worker-1 manifest uses a ref so
  // the seat can commit; a manifest that pins a SHA is asking for the opposite, and must get it.
  // This is also the only fixture that isolates the "HEAD is not at the expected anchor" check:
  // while HEAD tracks a branch it IS that branch's tip, so nothing else can separate them.
  const manifestPath = writeManifest(root, {
    session_anchor: { expected_branch: 'worker-one', expected_head: base, require_clean: true },
  });
  sessionStart(root, manifestPath, 's1');

  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'work\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'work');

  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /not at the expected anchor/);
});

test('PreToolUse denies an expired marker', () => {
  const { root } = makeRepo('expiry');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  const markerPath = guardSessionMarkerPath(root, 's1');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  marker.expires_at = Date.now() - 1000;
  fs.writeFileSync(markerPath, JSON.stringify(marker));

  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
  assert.match(reason(gate), /expired/i);
});

test('SessionStart mints no marker when the anchor does not verify', () => {
  const { root } = makeRepo('dirtystart');
  const manifestPath = writeManifest(root);
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'dirty\n');

  const start = sessionStart(root, manifestPath, 's1');
  assert.match(start.json.hookSpecificOutput.additionalContext, /STOP/);
  assert.equal(fs.existsSync(guardSessionMarkerPath(root, 's1')), false);

  const gate = preToolUse(root, manifestPath, 's1', 'Edit', ...editOwned(root));
  assert.equal(decision(gate), 'deny');
});

test('TaskCompleted blocks across the real process boundary when no session was armed', () => {
  const { root } = makeRepo('finish');
  const manifestPath = writeManifest(root);
  const result = runHook(root, manifestPath, {
    cwd: root, hook_event_name: 'TaskCompleted', task_id: '1', task_subject: 'packet', session_id: 's1',
  });
  assert.equal(result.json.decision, 'block');
});

test('TaskCompleted is reachable across the real process boundary once a session is armed', () => {
  const { root } = makeRepo('finish-armed');
  const manifestPath = writeManifest(root);
  sessionStart(root, manifestPath, 's1');

  // finish.enabled is false here, so the expected verdict is the FINISH refusal -- not the
  // anchor refusal. Distinguishing the two is the point: a guard that blocks for the wrong
  // reason still reads as a block, and that is how this defect stayed invisible.
  const result = runHook(root, manifestPath, {
    cwd: root, hook_event_name: 'TaskCompleted', task_id: '1', task_subject: 'packet', session_id: 's1',
  });
  assert.equal(result.json.decision, 'block');
  assert.match(result.json.reason, /not armed for this packet/);
  assert.doesNotMatch(result.json.reason, /anchor/);
});
