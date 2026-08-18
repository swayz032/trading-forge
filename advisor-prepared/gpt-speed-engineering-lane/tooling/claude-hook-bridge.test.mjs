import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluateHookEvent, guardSessionMarkerPath } from './claude-hook-bridge.mjs';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-hook-'));
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

function manifest(base, overrides = {}) {
  return {
    schema: 'gpt-claude-hook-guard-v1',
    worker: 'worker-1',
    session_anchor: {
      expected_branch: 'worker-one',
      // A REF, not the SHA this fixture used to pin. The live Worker-1 manifest anchors to the
      // branch on purpose — a SHA goes stale the moment the worker commits, and the fixture
      // pinning a SHA meant the finish tests below were exercising a session whose anchor could
      // never have verified in production. The old fabricated env hid that.
      expected_head: 'worker-one',
      require_clean: true,
    },
    edit_scope: {
      allowed_exact: ['src/server/compiler/lower.ts'],
      allowed_prefixes: [],
    },
    finish: { enabled: false },
    ...overrides,
  };
}

function session(root) {
  return { cwd: root, hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' };
}
function pre(root, tool_name, tool_input) {
  return { cwd: root, hook_event_name: 'PreToolUse', tool_name, tool_input, session_id: 's1' };
}
function taskCompleted(root) {
  return { cwd: root, hook_event_name: 'TaskCompleted', task_id: '1', task_subject: 'packet', session_id: 's1' };
}
function subagentStop(root, overrides = {}) {
  return {
    cwd: root, hook_event_name: 'SubagentStop', session_id: 's1',
    agent_id: 'agent-1', agent_type: 'general-purpose', last_assistant_message: 'the answer',
    ...overrides,
  };
}
/**
 * 🛑 REPLACES `verifiedEnv()`, which returned `{ TF_CLAUDE_GUARD_ANCHOR_OK: '1' }`.
 *
 * That helper handed the consumer a FABRICATED environment. It asserted what PreToolUse does
 * once armed, and quietly assumed the arming worked — while the producer test asserted only that
 * SessionStart wrote a file. Two green halves, and the wire between them was broken for three
 * seats: SessionStart wrote to CLAUDE_ENV_FILE, PreToolUse read process.env, and nothing
 * connected the two.
 *
 * `A TEST THAT CONSTRUCTS THE STATE UNDER TEST PROVES ONLY THAT IT CAN CONSTRUCT IT.`
 *
 * This helper fabricates nothing. It runs the REAL SessionStart event and lets it arm the
 * session through the real durable marker, so every PreToolUse assertion below now depends on
 * SessionStart actually having worked. claude-hook-lifecycle.test.mjs carries the same handshake
 * across two REAL OS processes, which is the part no in-process test can stand in for.
 */
function arm(root, m) {
  const result = evaluateHookEvent({ input: session(root), manifest: m });
  assert.equal(result._audit.anchor.ok, true, 'fixture failed to arm the guard session');
  return result;
}

function permissionDecision(result) {
  return result.hookSpecificOutput?.permissionDecision || null;
}

test('SessionStart verifies exact anchor and mints a marker BOUND to what it verified', () => {
  const { root, base } = makeRepo();
  const result = evaluateHookEvent({ input: session(root), manifest: manifest(base) });
  assert.equal(result._audit.anchor.ok, true);
  assert.equal(result._audit.armed, true);
  assert.match(result.hookSpecificOutput.additionalContext, /anchor verified/);

  // The marker must NAME what it proved. A bare constant is safe only while it is broken: the
  // moment it propagates, an unbound "armed" flag is inherited by the next session on the wrong
  // branch or a rewound HEAD, with every receipt green.
  const marker = JSON.parse(fs.readFileSync(guardSessionMarkerPath(root, 's1'), 'utf8'));
  assert.equal(marker.session_id, 's1');
  assert.equal(marker.branch, 'worker-one');
  assert.equal(marker.head, base);
  assert.equal(marker.worktree, path.resolve(root));
  assert.ok(marker.expires_at > marker.armed_at);
});

test('SessionStart exposes STOP and mints no marker on a moved anchor', () => {
  const { root, base } = makeRepo();
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'dirty\n');
  const result = evaluateHookEvent({ input: session(root), manifest: manifest(base) });
  assert.equal(result._audit.anchor.ok, false);
  assert.equal(result._audit.armed, false);
  assert.match(result.hookSpecificOutput.additionalContext, /STOP/);
  assert.equal(fs.existsSync(guardSessionMarkerPath(root, 's1')), false);
});

test('a refused SessionStart REVOKES a marker an earlier session left behind', () => {
  const { root, base } = makeRepo();
  evaluateHookEvent({ input: session(root), manifest: manifest(base) });
  assert.equal(fs.existsSync(guardSessionMarkerPath(root, 's1')), true);

  // Without revocation the failing seat simply inherits the last passing seat's proof.
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'dirty\n');
  const result = evaluateHookEvent({ input: session(root), manifest: manifest(base) });
  assert.equal(result._audit.anchor.ok, false);
  assert.equal(fs.existsSync(guardSessionMarkerPath(root, 's1')), false);
});

test('PreToolUse denies edits when SessionStart never armed the session', () => {
  const { root, base } = makeRepo();
  const result = evaluateHookEvent({
    input: pre(root, 'Edit', { file_path: path.join(root, 'src/server/compiler/lower.ts'), old_string: 'base', new_string: 'x' }),
    manifest: manifest(base),
  });
  assert.equal(permissionDecision(result), 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /not armed/);
});

test('PreToolUse permits owned path inside explicit packet scope without auto-approving permissions', () => {
  const { root, base } = makeRepo();
  const m = manifest(base);
  arm(root, m);
  const result = evaluateHookEvent({
    input: pre(root, 'Edit', { file_path: path.join(root, 'src/server/compiler/lower.ts'), old_string: 'base', new_string: 'x' }),
    manifest: m,
  });
  assert.equal(permissionDecision(result), null);
  assert.equal(result._audit.lane.safe_to_edit_without_handoff, true);
  assert.equal(result._audit.scope.ok, true);
});

test('PreToolUse denies obvious cross-lane Worker 2 path', () => {
  const { root, base } = makeRepo();
  const m = manifest(base, { edit_scope: { allowed_exact: ['src/server/services/paper-engine.ts'], allowed_prefixes: [] } });
  arm(root, m);
  const result = evaluateHookEvent({
    input: pre(root, 'Write', { file_path: path.join(root, 'src/server/services/paper-engine.ts'), content: 'x' }),
    manifest: m,
  });
  assert.equal(permissionDecision(result), 'deny');
  // AR-1263 §7A reworded this to say WHY it is not overridable, and the reason must still
  // name the verdict and the offending path rather than being a generic refusal.
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /not scope-overridable/);
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /BLOCK:src\/server\/services\/paper-engine\.ts/);
});

test('PreToolUse denies same-lane path that is outside the authorized packet scope', () => {
  const { root, base } = makeRepo();
  const m = manifest(base);
  // Armed BEFORE the stray file exists: an untracked file is exactly what require_clean refuses
  // to start on, so arming afterwards would refuse for a reason that has nothing to do with scope.
  arm(root, m);
  const other = path.join(root, 'src/server/compiler/other.ts');
  fs.writeFileSync(other, 'x\n');
  const result = evaluateHookEvent({
    input: pre(root, 'Write', { file_path: other, content: 'x' }),
    manifest: m,
  });
  assert.equal(permissionDecision(result), 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /authorized edit scope rejected/);
});

test('PreToolUse denies a path outside repository root', () => {
  const { root, base } = makeRepo();
  const m = manifest(base);
  arm(root, m);
  const result = evaluateHookEvent({
    input: pre(root, 'Write', { file_path: path.join(path.dirname(root), 'escape.ts'), content: 'x' }),
    manifest: m,
  });
  assert.equal(permissionDecision(result), 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /escapes repository root/);
});

test('Bash read/test commands remain fast while mutation commands are denied', () => {
  const { root, base } = makeRepo();
  const m = manifest(base);
  arm(root, m);
  const safe = evaluateHookEvent({ input: pre(root, 'Bash', { command: 'npm test -- --runInBand' }), manifest: m });
  assert.equal(permissionDecision(safe), null);

  for (const command of [
    "sed -i 's/a/b/' src/server/compiler/lower.ts",
    'cat payload > src/server/compiler/lower.ts',
    'git switch other-branch',
    'git reset --hard HEAD~1',
    "node -e \"require('fs').writeFileSync('src/server/compiler/lower.ts','x')\"",
  ]) {
    const blocked = evaluateHookEvent({ input: pre(root, 'Bash', { command }), manifest: m });
    assert.equal(permissionDecision(blocked), 'deny', command);
  }
});

test('TaskCompleted is fail-closed when finish verification is not armed', () => {
  const { root, base } = makeRepo();
  const m = manifest(base);
  arm(root, m);
  const result = evaluateHookEvent({ input: taskCompleted(root), manifest: m });
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /finish verification is not armed/);
});

test('TaskCompleted passes only after real clean commit and mechanically valid receipt', () => {
  const { root, base } = makeRepo();
  const m = manifest(base, {
    finish: {
      enabled: true,
      base,
      head: 'HEAD',
      receipt_file: '.git/gpt-worker-receipt.json',
    },
  });
  // The seat arms at the anchor and THEN does its work, which is the order production runs in.
  // The armed marker must survive the worker's own commit — a guard that bricks after the first
  // commit is a guard that gets switched off.
  arm(root, m);

  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'work\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'work');
  const head = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, '.git', 'gpt-worker-receipt.json'), JSON.stringify({
    commit: head,
    branch: 'worker-one',
    files_changed: ['src/server/compiler/lower.ts'],
    pushed: true,
    stopped_for_gpt: true,
  }));

  const result = evaluateHookEvent({ input: taskCompleted(root), manifest: m });
  assert.equal(result.decision, undefined);
  assert.equal(result._audit.finish.ok, true);
  assert.equal(result._audit.finish.verdict, 'PASS_FOR_GPT_REVIEW');
});

test('TaskCompleted blocks a false receipt instead of reporting fake green', () => {
  const { root, base } = makeRepo();
  const m = manifest(base, { finish: { enabled: true, base, receipt_file: '.git/gpt-worker-receipt.json' } });
  arm(root, m);

  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'work\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'work');
  const head = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, '.git', 'gpt-worker-receipt.json'), JSON.stringify({
    commit: head,
    branch: 'worker-one',
    files_changed: ['src/server/compiler/fake.ts'],
    pushed: true,
    stopped_for_gpt: true,
  }));

  const result = evaluateHookEvent({ input: taskCompleted(root), manifest: m });
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /finish check failed/);
});

// ---------------------------------------------------------------------------
// AR-1315A §5 Lane B — SubagentStop. 🛑 THIS EVENT MUST NEVER PRODUCE `decision`/`block`: for
// Stop/SubagentStop hooks that means "force the agent to keep running", the opposite of a
// refusal, and it is never correct to force an already-finished subagent to continue. Every
// scenario below asserts the ABSENCE of a `decision` field, not merely a particular value.
// ---------------------------------------------------------------------------

test('SubagentStop on an unarmed session records nothing observable -- never a decision/block, never forces the agent to continue', () => {
  const { root, base } = makeRepo();
  const m = manifest(base); // no SessionStart call at all
  const result = evaluateHookEvent({ input: subagentStop(root), manifest: m });
  assert.equal(result.decision, undefined);
  assert.equal(result._audit.anchor_verified, false);
});

test('SubagentStop with g2_precall disabled is a plain pass-through -- armed session, no decision', () => {
  const { root, base } = makeRepo();
  const m = manifest(base); // finish.enabled:false, no g2_precall block at all
  arm(root, m);
  const result = evaluateHookEvent({ input: subagentStop(root), manifest: m });
  assert.equal(result.decision, undefined);
  assert.equal(result._audit.guarded, false);
});

test('SubagentStop with g2_precall enabled but no configured queue/receipt_dir path still never emits a decision on an internal error', () => {
  const { root, base } = makeRepo();
  const m = manifest(base, {
    g2_precall: { enabled: true, strict_session: true, queue_path: 'does/not/exist.json', receipt_dir: 'does/not/exist', native_call_manifest_path: 'does/not/exist2.json' },
  });
  arm(root, m);
  const result = evaluateHookEvent({ input: subagentStop(root), manifest: m });
  assert.equal(result.decision, undefined, 'a load failure must fail closed on the RECORD, never force the agent to continue');
  assert.ok(result._audit.subagent_stop_error, 'the failure is still visible in the audit trail');
});
