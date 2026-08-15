import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluateHookEvent } from './claude-hook-bridge.mjs';

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
      expected_head: base,
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
function verifiedEnv(extra = {}) {
  return { TF_CLAUDE_GUARD_ANCHOR_OK: '1', ...extra };
}

function permissionDecision(result) {
  return result.hookSpecificOutput?.permissionDecision || null;
}

test('SessionStart verifies exact anchor and persists guard marker', () => {
  const { root, base } = makeRepo();
  const envFile = path.join(root, '.git', 'claude-env');
  const result = evaluateHookEvent({ input: session(root), manifest: manifest(base), env: { CLAUDE_ENV_FILE: envFile } });
  assert.equal(result._audit.anchor.ok, true);
  assert.match(result.hookSpecificOutput.additionalContext, /anchor verified/);
  assert.match(fs.readFileSync(envFile, 'utf8'), /TF_CLAUDE_GUARD_ANCHOR_OK=1/);
});

test('SessionStart exposes STOP and does not arm session on moved anchor', () => {
  const { root, base } = makeRepo();
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'dirty\n');
  const envFile = path.join(root, '.git', 'claude-env');
  const result = evaluateHookEvent({ input: session(root), manifest: manifest(base), env: { CLAUDE_ENV_FILE: envFile } });
  assert.equal(result._audit.anchor.ok, false);
  assert.match(result.hookSpecificOutput.additionalContext, /STOP/);
  assert.equal(fs.existsSync(envFile), false);
});

test('PreToolUse denies edits when SessionStart anchor marker is absent', () => {
  const { root, base } = makeRepo();
  const result = evaluateHookEvent({
    input: pre(root, 'Edit', { file_path: path.join(root, 'src/server/compiler/lower.ts'), old_string: 'base', new_string: 'x' }),
    manifest: manifest(base),
    env: {},
  });
  assert.equal(permissionDecision(result), 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /anchor was not verified/);
});

test('PreToolUse permits owned path inside explicit packet scope without auto-approving permissions', () => {
  const { root, base } = makeRepo();
  const result = evaluateHookEvent({
    input: pre(root, 'Edit', { file_path: path.join(root, 'src/server/compiler/lower.ts'), old_string: 'base', new_string: 'x' }),
    manifest: manifest(base),
    env: verifiedEnv(),
  });
  assert.equal(permissionDecision(result), null);
  assert.equal(result._audit.lane.safe_to_edit_without_handoff, true);
  assert.equal(result._audit.scope.ok, true);
});

test('PreToolUse denies obvious cross-lane Worker 2 path', () => {
  const { root, base } = makeRepo();
  const result = evaluateHookEvent({
    input: pre(root, 'Write', { file_path: path.join(root, 'src/server/services/paper-engine.ts'), content: 'x' }),
    manifest: manifest(base, { edit_scope: { allowed_exact: ['src/server/services/paper-engine.ts'], allowed_prefixes: [] } }),
    env: verifiedEnv(),
  });
  assert.equal(permissionDecision(result), 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /lane guard rejected/);
});

test('PreToolUse denies same-lane path that is outside the authorized packet scope', () => {
  const { root, base } = makeRepo();
  const other = path.join(root, 'src/server/compiler/other.ts');
  fs.writeFileSync(other, 'x\n');
  const result = evaluateHookEvent({
    input: pre(root, 'Write', { file_path: other, content: 'x' }),
    manifest: manifest(base),
    env: verifiedEnv(),
  });
  assert.equal(permissionDecision(result), 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /authorized edit scope rejected/);
});

test('PreToolUse denies a path outside repository root', () => {
  const { root, base } = makeRepo();
  const result = evaluateHookEvent({
    input: pre(root, 'Write', { file_path: path.join(path.dirname(root), 'escape.ts'), content: 'x' }),
    manifest: manifest(base),
    env: verifiedEnv(),
  });
  assert.equal(permissionDecision(result), 'deny');
  assert.match(result.hookSpecificOutput.permissionDecisionReason, /escapes repository root/);
});

test('Bash read/test commands remain fast while mutation commands are denied', () => {
  const { root, base } = makeRepo();
  const safe = evaluateHookEvent({ input: pre(root, 'Bash', { command: 'npm test -- --runInBand' }), manifest: manifest(base), env: verifiedEnv() });
  assert.equal(permissionDecision(safe), null);

  for (const command of [
    "sed -i 's/a/b/' src/server/compiler/lower.ts",
    'cat payload > src/server/compiler/lower.ts',
    'git switch other-branch',
    'git reset --hard HEAD~1',
    "node -e \"require('fs').writeFileSync('src/server/compiler/lower.ts','x')\"",
  ]) {
    const blocked = evaluateHookEvent({ input: pre(root, 'Bash', { command }), manifest: manifest(base), env: verifiedEnv() });
    assert.equal(permissionDecision(blocked), 'deny', command);
  }
});

test('TaskCompleted is fail-closed when finish verification is not armed', () => {
  const { root, base } = makeRepo();
  const result = evaluateHookEvent({ input: taskCompleted(root), manifest: manifest(base), env: verifiedEnv() });
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /not armed/);
});

test('TaskCompleted passes only after real clean commit and mechanically valid receipt', () => {
  const { root, base } = makeRepo();
  fs.appendFileSync(path.join(root, 'src/server/compiler/lower.ts'), 'work\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'work');
  const head = git(root, 'rev-parse', 'HEAD');
  const receiptPath = path.join(root, '.git', 'gpt-worker-receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify({
    commit: head,
    branch: 'worker-one',
    files_changed: ['src/server/compiler/lower.ts'],
    pushed: true,
    stopped_for_gpt: true,
  }));
  const m = manifest(base, {
    finish: {
      enabled: true,
      base,
      head: 'HEAD',
      receipt_file: '.git/gpt-worker-receipt.json',
    },
  });
  const result = evaluateHookEvent({ input: taskCompleted(root), manifest: m, env: verifiedEnv() });
  assert.equal(result.decision, undefined);
  assert.equal(result._audit.finish.ok, true);
  assert.equal(result._audit.finish.verdict, 'PASS_FOR_GPT_REVIEW');
});

test('TaskCompleted blocks a false receipt instead of reporting fake green', () => {
  const { root, base } = makeRepo();
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
  const m = manifest(base, { finish: { enabled: true, base, receipt_file: '.git/gpt-worker-receipt.json' } });
  const result = evaluateHookEvent({ input: taskCompleted(root), manifest: m, env: verifiedEnv() });
  assert.equal(result.decision, 'block');
  assert.match(result.reason, /finish check failed/);
});
